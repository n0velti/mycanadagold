import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  Vibration,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { isConnectedStatus } from '../lib/callState';
import { mobileSafeBottom, mobileSafeTop } from '../lib/mobileUi';
import { callPartyLabel } from '../lib/phoneCalls';
import { formatPhoneNumber } from '../lib/ringcentral';
import { activeCallKicker, formatCallClock, usePhoneCalls } from './PhoneCallProvider';

const fontFamily = 'Sohne';
const titleFontFamily = 'SohneLeicht';
const GREEN = '#34C759';
const RED = '#FF3B30';
const SHEET_BG = '#0F2E1D';
const SHEET_BG_DEEP = '#081C11';
const ANSWER_HINT_NATIVE = 'Picks up on the store’s RingCentral phone.';
/** Vibrate 0.7s, pause 0.7s, repeat while ringing (iOS ignores durations but keeps the cadence). */
const VIBRATE_PATTERN = [0, 700, 700];

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
  const scale = progress.interpolate({ inputRange: [0, 1], outputRange: [1, 1.9] });
  const opacity = progress.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 0.45, 0] });
  return <Animated.View pointerEvents="none" style={[styles.pulseRing, { opacity, transform: [{ scale }] }]} />;
}

function CallerAvatar({ name, size = 96 }) {
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
          <Ionicons name="person" size={Math.round(size * 0.46)} color="#DCFCE7" />
        )}
      </View>
    </View>
  );
}

function RoundAction({ icon, label, color, onPress, disabled, busy, rotate, accessibilityLabel }) {
  return (
    <View style={styles.roundActionWrap}>
      <Pressable
        onPress={onPress}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel || label}
        style={({ pressed }) => [
          styles.roundAction,
          { backgroundColor: color },
          pressed && styles.roundActionPressed,
          disabled && !busy && styles.roundActionDisabled,
        ]}
      >
        {busy ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Ionicons name={icon} size={34} color="#fff" style={rotate ? styles.hangupIcon : null} />
        )}
      </Pressable>
      <Text style={styles.roundActionLabel}>{label}</Text>
    </View>
  );
}

function PillAction({ icon, label, color, onPress, disabled, busy, rotate, accessibilityLabel }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || label}
      style={({ pressed }) => [
        styles.pill,
        { backgroundColor: color },
        pressed && styles.roundActionPressed,
        disabled && !busy && styles.roundActionDisabled,
      ]}
    >
      {busy ? (
        <ActivityIndicator size="small" color="#fff" />
      ) : (
        <Ionicons name={icon} size={18} color="#fff" style={rotate ? styles.hangupIcon : null} />
      )}
      <Text style={styles.pillText}>{label}</Text>
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
 * Full-screen incoming call, modelled on the native phone UI: who is calling
 * and for which store, one big green Answer and one big red Decline.
 */
function IncomingCallSheet({ calls, busy, error, silent, onSilent, onAnswer, onReject }) {
  const primary = calls[0];
  const others = calls.slice(1);
  const { title, subtitle } = callerLines(primary);
  const name = primary.direction !== 'Outbound' ? primary.fromName : primary.toName;

  return (
    <Modal
      visible
      animationType="slide"
      presentationStyle="fullScreen"
      statusBarTranslucent
      onRequestClose={() => {}}
    >
      <StatusBar style="light" />
      <View style={styles.sheet}>
        <View style={[styles.sheetGlow, styles.sheetGlowOuter]} pointerEvents="none" />
        <View style={[styles.sheetGlow, styles.sheetGlowInner]} pointerEvents="none" />
        <View
          style={[styles.sheetTop, { paddingTop: mobileSafeTop() + 8 }]}
          {...(Platform.OS === 'web' ? { className: 'cgold-mobile-sheet-top' } : null)}
        >
          <View style={styles.sheetTopCopy}>
            <View style={styles.kickerRow}>
              <View style={styles.liveDot} />
              <Text style={styles.kicker}>Incoming call</Text>
            </View>
            <Text style={styles.storeLine} numberOfLines={1}>
              {storeLine(primary)}
            </Text>
          </View>
          <Pressable
            onPress={onSilent}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={silent ? 'Turn ringtone on' : 'Silence ringtone'}
            style={({ pressed }) => [styles.silence, pressed && styles.roundActionPressed]}
          >
            <Ionicons name={silent ? 'volume-mute' : 'volume-high'} size={20} color="#fff" />
          </Pressable>
        </View>

        <View style={styles.sheetBody}>
          <CallerAvatar name={name} />
          <Text style={styles.callerTitle} numberOfLines={3} adjustsFontSizeToFit minimumFontScale={0.7}>
            {title}
          </Text>
          {subtitle ? (
            <Text style={styles.callerSubtitle} numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>

        {others.length ? (
          <View style={styles.others}>
            <Text style={styles.othersKicker}>
              {others.length === 1 ? 'Also ringing' : `${others.length} more ringing`}
            </Text>
            {others.map((call) => {
              const lines = callerLines(call);
              return (
                <View key={`${call.storeKey}-${call.id}`} style={styles.otherRow}>
                  <View style={styles.otherCopy}>
                    <Text style={styles.otherTitle} numberOfLines={1}>
                      {lines.title}
                    </Text>
                    <Text style={styles.otherMeta} numberOfLines={1}>
                      {[lines.subtitle, storeLine(call)].filter(Boolean).join(' · ')}
                    </Text>
                  </View>
                  <Pressable
                    onPress={() => onReject(call)}
                    disabled={busy}
                    accessibilityRole="button"
                    accessibilityLabel={`Decline call from ${lines.title}`}
                    style={({ pressed }) => [styles.otherBtn, { backgroundColor: RED }, pressed && styles.roundActionPressed]}
                  >
                    <Ionicons name="close" size={20} color="#fff" />
                  </Pressable>
                  <Pressable
                    onPress={() => onAnswer(call)}
                    disabled={busy}
                    accessibilityRole="button"
                    accessibilityLabel={`Answer call from ${lines.title}`}
                    style={({ pressed }) => [styles.otherBtn, { backgroundColor: GREEN }, pressed && styles.roundActionPressed]}
                  >
                    <Ionicons name="call" size={20} color="#fff" />
                  </Pressable>
                </View>
              );
            })}
          </View>
        ) : null}

        <View style={[styles.sheetActions, { paddingBottom: mobileSafeBottom() + 28 }]}>
          {error ? (
            <Text style={styles.sheetError} numberOfLines={3}>
              {error}
            </Text>
          ) : null}
          <View style={styles.roundActions}>
            <RoundAction
              icon="close"
              label="Decline"
              color={RED}
              disabled={busy}
              onPress={() => onReject(primary)}
              accessibilityLabel={`Decline call from ${title}`}
            />
            <RoundAction
              icon="call"
              label="Answer"
              color={GREEN}
              disabled={busy}
              busy={busy}
              onPress={() => onAnswer(primary)}
              accessibilityLabel={`Answer call from ${title}`}
            />
          </View>
          {Platform.OS !== 'web' ? <Text style={styles.answerHint}>{ANSWER_HINT_NATIVE}</Text> : null}
        </View>
      </View>
    </Modal>
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
          <Text style={styles.barKicker} numberOfLines={1}>
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
          <Pressable
            onPress={onEnableSound}
            accessibilityRole="button"
            accessibilityLabel="Enable sound for this call"
            style={({ pressed }) => [styles.barBtn, styles.barBtnSound, pressed && styles.roundActionPressed]}
          >
            <Ionicons name="volume-high" size={22} color="#1a1a1a" />
          </Pressable>
        ) : null}
        {canMute ? (
          <Pressable
            onPress={onMute}
            disabled={busy || !connected}
            accessibilityRole="button"
            accessibilityLabel={muted ? 'Unmute microphone' : 'Mute microphone'}
            style={({ pressed }) => [
              styles.barBtn,
              muted ? styles.barBtnMuteOn : styles.barBtnMute,
              pressed && styles.roundActionPressed,
            ]}
          >
            <Ionicons name={muted ? 'mic-off' : 'mic'} size={22} color="#fff" />
          </Pressable>
        ) : null}
        <Pressable
          onPress={onHangup}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel="Hang up"
          style={({ pressed }) => [styles.barBtn, { backgroundColor: RED }, pressed && styles.roundActionPressed]}
        >
          {busy ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Ionicons name="call" size={22} color="#fff" style={styles.hangupIcon} />
          )}
        </Pressable>
      </View>
    </View>
  );
}

/** A second call ringing while one is live: compact, but still thumb-sized. */
function WaitingCallRow({ call, busy, onAnswer, onReject }) {
  const { title, subtitle } = callerLines(call);
  return (
    <View style={styles.waitingRow} accessibilityLabel={`Incoming call from ${title} at ${call.storeName || 'store'}`}>
      <View style={styles.activeCopy}>
        <Text style={styles.barKicker} numberOfLines={1}>
          Ringing · {storeLine(call)}
        </Text>
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
        <PillAction icon="close" label="Decline" color={RED} disabled={busy} onPress={() => onReject(call)} />
        <PillAction icon="call" label="Answer" color={GREEN} disabled={busy} busy={busy} onPress={() => onAnswer(call)} />
      </View>
    </View>
  );
}

/**
 * Phone UI for the mobile shell. A ringing call with nothing else live takes
 * the whole screen; a live call (and anything ringing over it) sits in a bar
 * above the tab bar.
 */
export default function MobilePhoneDock() {
  const {
    incoming,
    recentAnswered,
    activeCall,
    muted,
    toggleMute,
    audioState,
    resumeAudio,
    busy,
    error,
    silent,
    setSilent,
    answer,
    reject,
    hangup,
  } = usePhoneCalls();

  const ringing = (incoming || []).filter((call) => call.id !== activeCall?.id);
  const showSheet = ringing.length > 0 && !activeCall;
  useRingVibration(showSheet && !silent);

  if (!ringing.length && !recentAnswered.length && !activeCall) return null;

  const swallow = (promise) => promise.catch(() => {});
  const onAnswer = (call) => swallow(answer(call));
  const onReject = (call) => swallow(reject(call));
  const onHangup = () => swallow(hangup(activeCall));
  const onEnableSound = () => swallow(resumeAudio());
  const onSilent = () => setSilent(!silent);

  if (showSheet) {
    return (
      <IncomingCallSheet
        calls={ringing}
        busy={busy}
        error={error}
        silent={silent}
        onSilent={onSilent}
        onAnswer={onAnswer}
        onReject={onReject}
      />
    );
  }

  const answered = recentAnswered.filter((row) => row.callId !== activeCall?.id);
  return (
    <View style={styles.dock}>
      {activeCall ? (
        <ActiveCallBar
          call={activeCall}
          busy={busy}
          muted={muted}
          audioState={audioState}
          onMute={toggleMute}
          onHangup={onHangup}
          onEnableSound={onEnableSound}
        />
      ) : null}
      {activeCall && audioState === 'blocked' ? (
        <Text style={styles.dockNote} numberOfLines={2}>
          The browser blocked the call audio. Tap the speaker button to hear the caller.
        </Text>
      ) : null}
      {ringing.map((call) => (
        <WaitingCallRow key={`${call.storeKey}-${call.id}`} call={call} busy={busy} onAnswer={onAnswer} onReject={onReject} />
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
      {error && (ringing.length || activeCall) ? (
        <Text style={styles.dockError} numberOfLines={3}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // --- Full-screen incoming sheet -------------------------------------------
  sheet: {
    flex: 1,
    backgroundColor: SHEET_BG,
    justifyContent: 'space-between',
    overflow: 'hidden',
  },
  sheetGlow: {
    position: 'absolute',
    left: '50%',
    backgroundColor: '#1F5A38',
  },
  sheetGlowOuter: {
    top: -520,
    marginLeft: -420,
    width: 840,
    height: 840,
    borderRadius: 420,
    opacity: 0.22,
  },
  sheetGlowInner: {
    top: -380,
    marginLeft: -300,
    width: 600,
    height: 600,
    borderRadius: 300,
    opacity: 0.22,
  },
  sheetTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 20,
    gap: 12,
  },
  sheetTopCopy: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  kickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minWidth: 0,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: GREEN,
  },
  liveDotConnected: {
    backgroundColor: '#86EFAC',
  },
  kicker: {
    fontFamily,
    fontSize: 13,
    fontWeight: '700',
    color: '#BBF7D0',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  storeLine: {
    fontFamily,
    fontSize: 17,
    fontWeight: '600',
    color: '#fff',
    letterSpacing: -0.2,
  },
  silence: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  sheetBody: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    gap: 6,
  },
  avatarWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 22,
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
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.22)',
  },
  avatarInitials: {
    fontFamily,
    fontWeight: '600',
    color: '#fff',
    letterSpacing: 0.5,
  },
  callerTitle: {
    fontFamily: titleFontFamily,
    fontSize: 30,
    lineHeight: 36,
    color: '#fff',
    textAlign: 'center',
    letterSpacing: -0.6,
  },
  callerSubtitle: {
    fontFamily,
    fontSize: 19,
    color: '#BBF7D0',
    textAlign: 'center',
    letterSpacing: -0.2,
    fontVariant: ['tabular-nums'],
  },
  others: {
    marginHorizontal: 16,
    marginBottom: 22,
    padding: 12,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.08)',
    gap: 8,
  },
  othersKicker: {
    fontFamily,
    fontSize: 11,
    fontWeight: '700',
    color: '#BBF7D0',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  otherRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 44,
  },
  otherCopy: {
    flex: 1,
    minWidth: 0,
  },
  otherTitle: {
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
  },
  otherMeta: {
    fontFamily,
    fontSize: 12,
    color: '#BBF7D0',
  },
  otherBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetActions: {
    paddingHorizontal: 24,
    gap: 16,
  },
  sheetError: {
    fontFamily,
    fontSize: 13,
    lineHeight: 18,
    color: '#FECACA',
    textAlign: 'center',
    paddingHorizontal: 8,
  },
  roundActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
  },
  roundActionWrap: {
    alignItems: 'center',
    gap: 10,
  },
  roundAction: {
    width: 76,
    height: 76,
    borderRadius: 38,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {
        shadowColor: '#000',
        shadowOpacity: 0.3,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 6 },
        elevation: 6,
      },
    }),
  },
  roundActionPressed: {
    opacity: 0.78,
    transform: [{ scale: 0.96 }],
  },
  roundActionDisabled: {
    opacity: 0.5,
  },
  roundActionLabel: {
    fontFamily,
    fontSize: 14,
    fontWeight: '500',
    color: '#fff',
  },
  hangupIcon: {
    transform: [{ rotate: '135deg' }],
  },
  answerHint: {
    fontFamily,
    fontSize: 12,
    color: 'rgba(187, 247, 208, 0.75)',
    textAlign: 'center',
  },

  // --- Dock above the tab bar ----------------------------------------------
  dock: {
    marginHorizontal: 10,
    marginBottom: 8,
    padding: 8,
    borderRadius: 18,
    backgroundColor: SHEET_BG_DEEP,
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
  activeBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.07)',
  },
  waitingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  activeCopy: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  barKicker: {
    fontFamily,
    fontSize: 11,
    fontWeight: '700',
    color: '#BBF7D0',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    flexShrink: 1,
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
  barBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  barBtnMute: {
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  barBtnMuteOn: {
    backgroundColor: '#B45309',
  },
  barBtnSound: {
    backgroundColor: '#FCD34D',
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 42,
    paddingHorizontal: 14,
    borderRadius: 21,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  pillText: {
    fontFamily,
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
  },
  answeredRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 36,
    paddingHorizontal: 8,
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
