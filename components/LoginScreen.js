import { forwardRef, useEffect, useRef, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  companyJoinEmail,
  loginEmailReady,
  lookupLoginEmail,
  peekLoginEmailKnown,
  rememberLoginEmail,
  warmupLoginEmailLookup,
} from '../lib/auth';
import { CANVAS, MOBILE, useIsMobile } from '../lib/mobileUi';
import { MobileSafeTop } from './MobileChrome';

const fontFamily = 'Sohne';
const LABEL = MOBILE.label;
const SECONDARY = MOBILE.secondary;
const CHIP_RADIUS = 8;
const PRESS_WASH = 'rgba(60,60,67,0.10)';
const FIELD_IDLE = 'rgba(60,60,67,0.06)';
const ICON_SIZE = 17;
const ICON_SLOT = 26;
const TRAIL_W = 28;
const TRAIL_W_MOBILE = 32;
const TRAIL_EASE = Easing.bezier(0.32, 0.72, 0, 1);
const MAIL = '#0A84FF';
const LOCK = '#6D28D9';
const LOGIN = '#2F8A4E';
const DONE = '#2F8A4E';

function iconColor(accent, active, hovered) {
  if (accent && (active || hovered)) return accent;
  if (accent) return accent;
  return active || hovered ? LABEL : SECONDARY;
}

function skipTabProps() {
  if (Platform.OS !== 'web') return { focusable: false, accessible: false };
  return { tabIndex: -1, focusable: false, accessible: false };
}

function tabTo(nextRef, event) {
  const key = event?.key || event?.nativeEvent?.key;
  const shift = event?.shiftKey || event?.nativeEvent?.shiftKey;
  if (key !== 'Tab' || shift) return;
  const node = nextRef?.current;
  if (!node || typeof node.focus !== 'function') return;
  event.preventDefault?.();
  event.nativeEvent?.preventDefault?.();
  node.focus();
}

function webTabProps(nextRef, enabled = true) {
  if (Platform.OS !== 'web') return null;
  return {
    tabIndex: enabled ? 0 : -1,
    onKeyDown: (event) => {
      if (enabled) tabTo(nextRef, event);
    },
  };
}

const FieldAction = forwardRef(function FieldAction({
  icon,
  iconActive,
  accent,
  onPress,
  disabled,
  busy = false,
  isMobile,
  accessibilityLabel,
  nextFocusRef,
}, ref) {
  const [hovered, setHovered] = useState(false);

  return (
    <Pressable
      ref={ref}
      onPress={onPress}
      disabled={disabled}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      {...webTabProps(nextFocusRef, !disabled)}
      style={({ hovered: pressHovered, pressed }) => [
        styles.fieldAction,
        isMobile && styles.fieldActionMobile,
        (hovered || pressHovered || pressed) && styles.fieldActionHover,
        disabled && styles.actionDisabled,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={accent || LABEL} />
      ) : (
        <Ionicons
          name={hovered || !disabled ? iconActive || icon : icon}
          size={isMobile ? 18 : ICON_SIZE}
          color={iconColor(accent, !disabled, hovered)}
        />
      )}
    </Pressable>
  );
});

const ChipField = forwardRef(function ChipField({
  icon,
  iconActive,
  accent,
  value,
  onChangeText,
  placeholder,
  isMobile,
  nextFocusRef,
  ...inputProps
}, ref) {
  const inputRef = useRef(null);
  const [focused, setFocused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const active = focused;

  const setInputRef = (node) => {
    inputRef.current = node;
    if (typeof ref === 'function') ref(node);
    else if (ref) ref.current = node;
  };

  return (
    <Pressable
      onPress={() => inputRef.current?.focus?.()}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      pressChrome={false}
      {...skipTabProps()}
      {...(Platform.OS === 'web'
        ? { onKeyDown: (event) => tabTo(nextFocusRef, event) }
        : null)}
      style={({ hovered: pressHovered, pressed }) => [
        styles.field,
        isMobile && styles.fieldMobile,
        !active && (hovered || pressHovered || pressed) && styles.fieldHover,
        active && styles.fieldActive,
      ]}
    >
      <View style={styles.iconSlot}>
        <Ionicons
          name={active && iconActive ? iconActive : icon}
          size={isMobile ? 18 : ICON_SIZE}
          color={iconColor(accent, active, hovered)}
        />
      </View>
      <TextInput
        ref={setInputRef}
        style={[styles.input, isMobile && styles.inputMobile]}
        value={value}
        onChangeText={onChangeText}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={placeholder}
        placeholderTextColor={SECONDARY}
        blurOnSubmit={false}
        {...inputProps}
        {...webTabProps(nextFocusRef)}
      />
    </Pressable>
  );
});

function PasswordRow({
  value,
  onChangeText,
  isMobile,
  submitting,
  canSubmit,
  onSubmit,
  action = 'login',
  onJoin,
  canJoin = false,
  inputRef,
  loginRef,
  nextAfterRef,
  ...inputProps
}) {
  const isJoin = action === 'join';
  const hasPassword = Boolean(String(value || '').trim());
  const visible = isJoin ? canJoin : hasPassword;
  const iconW = isMobile ? TRAIL_W_MOBILE : TRAIL_W;
  const open = useRef(new Animated.Value(visible ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(open, {
      toValue: visible ? 1 : 0,
      duration: 220,
      easing: TRAIL_EASE,
      useNativeDriver: false,
    }).start();
  }, [visible, open]);

  return (
    <View style={styles.passwordRow}>
      <View style={styles.passwordField}>
        <ChipField
          ref={inputRef}
          icon="lock-closed-outline"
          iconActive="lock-closed"
          accent={LOCK}
          value={value}
          onChangeText={onChangeText}
          placeholder="Password"
          isMobile={isMobile}
          nextFocusRef={visible ? loginRef : nextAfterRef}
          {...inputProps}
        />
      </View>
      <Animated.View
        pointerEvents={visible ? 'auto' : 'none'}
        style={[
          styles.loginSlot,
          {
            width: open.interpolate({
              inputRange: [0, 1],
              outputRange: [0, iconW + 8],
            }),
            opacity: open,
          },
        ]}
      >
        <View style={[styles.loginSlotInner, { width: iconW }]}>
          <FieldAction
            ref={loginRef}
            icon={isJoin ? 'person-add-outline' : 'log-in-outline'}
            iconActive={isJoin ? 'person-add' : 'log-in'}
            accent={isJoin ? MAIL : LOGIN}
            onPress={isJoin ? onJoin : onSubmit}
            disabled={isJoin ? !canJoin || submitting : !hasPassword || !canSubmit}
            busy={submitting}
            isMobile={isMobile}
            accessibilityLabel={isJoin ? 'Join' : 'Log in'}
            nextFocusRef={nextAfterRef}
          />
        </View>
      </Animated.View>
    </View>
  );
}

const ChipButton = forwardRef(function ChipButton({
  icon,
  iconActive,
  accent,
  label,
  onPress,
  disabled,
  selected = false,
  busy = false,
  isMobile,
  nextFocusRef,
}, ref) {
  const [hovered, setHovered] = useState(false);

  return (
    <Pressable
      ref={ref}
      onPress={onPress}
      disabled={disabled}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      accessibilityRole="button"
      accessibilityState={{ selected, disabled: Boolean(disabled) }}
      {...webTabProps(nextFocusRef, !disabled)}
      style={({ hovered: pressHovered, pressed }) => [
        styles.action,
        isMobile && styles.actionMobile,
        (hovered || pressHovered || pressed) && styles.actionHover,
        disabled && styles.actionDisabled,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={accent || LABEL} />
      ) : (
        <>
          {icon ? (
            <Ionicons
              name={selected && iconActive ? iconActive : icon}
              size={isMobile ? 18 : ICON_SIZE}
              color={iconColor(accent, true, hovered)}
            />
          ) : null}
          <Text style={[styles.actionLabel, isMobile && styles.actionLabelMobile]} selectable={false}>
            {label}
          </Text>
        </>
      )}
    </Pressable>
  );
});

export default function LoginScreen({
  mode = 'login',
  loginId,
  password,
  error,
  submitting,
  onChangeLoginId,
  onChangePassword,
  onSubmit,
  onJoin,
  onBackToLogin,
  newPassword = '',
  repeatPassword = '',
  passwordError = '',
  passwordSubmitting = false,
  onChangeNewPassword,
  onChangeRepeatPassword,
  onSubmitNewPassword,
  onCancelPassword,
}) {
  const isMobile = useIsMobile();
  const passwordRef = useRef(null);
  const loginRef = useRef(null);
  const doneRef = useRef(null);
  const backRef = useRef(null);
  const repeatRef = useRef(null);
  const [account, setAccount] = useState('idle');
  const joinEmail = companyJoinEmail(loginId);
  const showJoin = account === 'unknown' && Boolean(joinEmail);
  const canSubmit = Boolean(loginId.trim() && password.trim() && !submitting);
  const canSetPassword = Boolean(newPassword && repeatPassword && !passwordSubmitting);

  useEffect(() => {
    warmupLoginEmailLookup();
  }, []);

  useEffect(() => {
    if (mode !== 'login') return undefined;
    const cached = peekLoginEmailKnown(loginId);
    if (cached !== undefined) {
      setAccount(cached ? 'known' : 'unknown');
      return undefined;
    }
    const ready = joinEmail || loginEmailReady(loginId);
    if (!ready) {
      setAccount('idle');
      return undefined;
    }
    setAccount('idle');

    let cancelled = false;
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = setTimeout(async () => {
      try {
        const exists = await lookupLoginEmail(ready, { signal: controller?.signal });
        if (cancelled) return;
        setAccount(exists ? 'known' : 'unknown');
      } catch (lookupError) {
        if (cancelled || lookupError?.name === 'AbortError') return;
        // Lookup down: still let an existing user type a password.
        setAccount('known');
      }
    }, 0);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller?.abort();
    };
  }, [joinEmail, loginId, mode]);

  const handleJoin = async () => {
    if (!onJoin || !joinEmail || submitting) return;
    const result = await onJoin();
    if (result === 'exists') {
      rememberLoginEmail(loginId, true);
      setAccount('known');
    }
  };

  let body = null;
  let actions = null;

  if (mode === 'sent') {
    body = (
      <>
        <Text style={[styles.prompt, isMobile && styles.promptMobile]}>
          A temporary password has been sent to your email.
        </Text>
        <Text style={[styles.hint, isMobile && styles.hintMobile]}>
          Open that email, then log in here with your email and the temporary password.
        </Text>
      </>
    );
    actions = (
      <ChipButton
        icon="log-in-outline"
        iconActive="log-in"
        accent={LOGIN}
        label="Log in"
        onPress={onBackToLogin}
        selected
        isMobile={isMobile}
      />
    );
  } else if (mode === 'set-password') {
    body = (
      <>
        <Text style={[styles.prompt, isMobile && styles.promptMobile]}>Choose a password</Text>
        <Text style={[styles.hint, isMobile && styles.hintMobile]}>
          At least 12 characters, with an uppercase letter, a lowercase letter, and a number.
        </Text>
        <ChipField
          icon="lock-closed-outline"
          iconActive="lock-closed"
          accent={LOCK}
          value={newPassword}
          onChangeText={onChangeNewPassword}
          placeholder="Password"
          isMobile={isMobile}
          secureTextEntry
          textContentType="newPassword"
          editable={!passwordSubmitting}
          returnKeyType="next"
          nextFocusRef={repeatRef}
        />
        <ChipField
          ref={repeatRef}
          icon="lock-closed-outline"
          iconActive="lock-closed"
          accent={LOCK}
          value={repeatPassword}
          onChangeText={onChangeRepeatPassword}
          placeholder="Repeat password"
          isMobile={isMobile}
          secureTextEntry
          textContentType="newPassword"
          editable={!passwordSubmitting}
          returnKeyType="done"
          nextFocusRef={doneRef}
          onSubmitEditing={() => {
            if (canSetPassword) onSubmitNewPassword();
          }}
        />
        {passwordError ? <Text style={styles.errorText}>{passwordError}</Text> : null}
      </>
    );
    actions = (
      <>
        <ChipButton
          ref={doneRef}
          icon="checkmark-outline"
          iconActive="checkmark"
          accent={DONE}
          label="Done"
          onPress={onSubmitNewPassword}
          disabled={!canSetPassword}
          selected
          busy={passwordSubmitting}
          isMobile={isMobile}
          nextFocusRef={backRef}
        />
        <ChipButton
          ref={backRef}
          icon="chevron-back-outline"
          label="Back"
          onPress={onCancelPassword}
          disabled={passwordSubmitting}
          isMobile={isMobile}
        />
      </>
    );
  } else {
    body = (
      <>
        <ChipField
          icon="mail-outline"
          iconActive="mail"
          accent={MAIL}
          value={loginId}
          onChangeText={onChangeLoginId}
          placeholder="Email"
          isMobile={isMobile}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          textContentType="emailAddress"
          autoComplete="email"
          editable={!submitting}
          returnKeyType="next"
          nextFocusRef={passwordRef}
          onSubmitEditing={() => {
            if (showJoin) handleJoin();
            else passwordRef.current?.focus?.();
          }}
        />
        <PasswordRow
          value={password}
          onChangeText={onChangePassword}
          isMobile={isMobile}
          submitting={submitting}
          canSubmit={canSubmit}
          onSubmit={onSubmit}
          action={showJoin ? 'join' : 'login'}
          onJoin={handleJoin}
          canJoin={showJoin}
          inputRef={passwordRef}
          loginRef={loginRef}
          secureTextEntry
          textContentType="password"
          editable={!submitting}
          returnKeyType="done"
          onSubmitEditing={() => {
            if (showJoin) handleJoin();
            else if (canSubmit) onSubmit();
          }}
        />
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
      </>
    );
  }

  return (
    <View style={[styles.page, isMobile && styles.pageMobile]}>
      {isMobile ? <MobileSafeTop /> : null}
      <View style={[styles.inner, isMobile && styles.innerMobile]}>
        <View style={[styles.logoSlot, isMobile && styles.logoSlotMobile]} pointerEvents="none">
          <Image
            source={require('../assets/small_logo.png')}
            style={[styles.logo, isMobile && styles.logoMobile]}
            resizeMode="cover"
            accessibilityLabel="Canada Gold"
          />
        </View>

        <View style={[styles.form, isMobile && styles.formMobile]}>
          {body}
          {actions ? <View style={[styles.actions, isMobile && styles.actionsMobile]}>{actions}</View> : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: CANVAS,
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingHorizontal: 24,
    paddingTop: 72,
  },
  pageMobile: {
    paddingHorizontal: 0,
    paddingTop: 0,
    backgroundColor: CANVAS,
  },
  inner: {
    width: '100%',
    alignItems: 'center',
  },
  innerMobile: {
    flex: 1,
    justifyContent: 'flex-start',
    paddingHorizontal: 28,
    paddingTop: 64,
    paddingBottom: 48,
  },
  logoSlot: {
    width: '100%',
    alignItems: 'center',
    marginBottom: 128,
  },
  logoSlotMobile: {
    marginBottom: 112,
  },
  logo: {
    width: 72,
    height: 72,
    borderRadius: 36,
    overflow: 'hidden',
  },
  logoMobile: {
    width: 64,
    height: 64,
    borderRadius: 32,
  },
  form: {
    width: '100%',
    maxWidth: 360,
    gap: 8,
    zIndex: 1,
  },
  formMobile: {
    maxWidth: 400,
    gap: 10,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    alignSelf: 'stretch',
    marginTop: 2,
    paddingHorizontal: 2,
  },
  actionsMobile: {
    marginTop: 4,
    paddingHorizontal: 0,
  },
  passwordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'stretch',
    width: '100%',
  },
  passwordField: {
    flex: 1,
    minWidth: 0,
  },
  loginSlot: {
    overflow: 'hidden',
    alignItems: 'flex-end',
    justifyContent: 'center',
    flexShrink: 0,
  },
  loginSlotInner: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconSlot: {
    width: ICON_SLOT,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 40,
    paddingLeft: 8,
    paddingRight: 12,
    gap: 4,
    borderRadius: CHIP_RADIUS,
    borderWidth: 1,
    borderColor: 'transparent',
    backgroundColor: FIELD_IDLE,
    ...Platform.select({
      web: {
        cursor: 'text',
        boxSizing: 'border-box',
        outlineStyle: 'none',
        outlineWidth: 0,
        boxShadow: 'none',
      },
      default: {},
    }),
  },
  fieldMobile: {
    minHeight: 48,
    paddingLeft: 10,
    paddingRight: 8,
  },
  fieldAction: {
    width: TRAIL_W,
    height: TRAIL_W,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  fieldActionMobile: {
    width: TRAIL_W_MOBILE,
    height: TRAIL_W_MOBILE,
  },
  fieldActionHover: {
    backgroundColor: 'rgba(60,60,67,0.06)',
  },
  fieldHover: {
    backgroundColor: PRESS_WASH,
  },
  fieldActive: {
    backgroundColor: FIELD_IDLE,
    borderColor: 'transparent',
    ...Platform.select({
      web: { boxShadow: 'none', outlineStyle: 'none', outlineWidth: 0 },
      default: {},
    }),
  },
  input: {
    fontFamily,
    flex: 1,
    minWidth: 0,
    fontSize: 14,
    fontWeight: '400',
    color: LABEL,
    paddingVertical: 0,
    letterSpacing: -0.2,
    ...Platform.select({
      web: { outlineStyle: 'none', outlineWidth: 0, boxShadow: 'none' },
      default: {},
    }),
  },
  inputMobile: {
    fontSize: 16,
  },
  errorText: {
    fontFamily,
    fontSize: 13,
    color: '#b42318',
    letterSpacing: -0.2,
    paddingHorizontal: 2,
  },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    minHeight: 36,
    paddingVertical: 8,
    paddingHorizontal: 10,
    gap: 8,
    borderRadius: CHIP_RADIUS,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  actionMobile: {
    minHeight: 44,
    paddingVertical: 10,
    paddingHorizontal: 12,
    gap: 8,
  },
  actionHover: {
    backgroundColor: 'rgba(60,60,67,0.06)',
  },
  actionDisabled: {
    opacity: 0.5,
  },
  actionLabel: {
    fontFamily,
    fontSize: 14,
    fontWeight: '400',
    color: LABEL,
    letterSpacing: -0.2,
    ...Platform.select({
      web: { fontFamily: 'Sohne, sans-serif' },
      default: {},
    }),
  },
  actionLabelMobile: {
    fontFamily,
    fontSize: 16,
    fontWeight: '400',
    ...Platform.select({
      web: { fontFamily: 'Sohne, sans-serif' },
      default: {},
    }),
  },
  prompt: {
    fontFamily,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '400',
    color: LABEL,
    letterSpacing: -0.2,
    marginBottom: 4,
  },
  promptMobile: {
    fontSize: 16,
    lineHeight: 22,
  },
  hint: {
    fontFamily,
    fontSize: 13,
    lineHeight: 18,
    color: SECONDARY,
    letterSpacing: -0.2,
    marginTop: -4,
    marginBottom: 2,
  },
  hintMobile: {
    fontSize: 15,
    lineHeight: 21,
  },
});
