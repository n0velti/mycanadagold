import { Ionicons } from '@expo/vector-icons';
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { CANVAS, useIsMobile } from '../lib/mobileUi';
import { MobileSafeTop } from './MobileChrome';

const fontFamily = 'Sohne';
const ICON = '#8e8e93';

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
  joinEmail = '',
  joinError = '',
  joinSubmitting = false,
  onChangeJoinEmail,
  onSubmitJoin,
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
  const canSubmit = Boolean(loginId.trim() && password.trim() && !submitting);
  const canJoin = Boolean(joinEmail.trim() && !joinSubmitting);
  const canSetPassword = Boolean(newPassword && repeatPassword && !passwordSubmitting);

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

        <View style={[styles.card, isMobile && styles.cardMobile]}>
          {mode === 'join' ? (
            <>
              <Text style={[styles.prompt, isMobile && styles.promptMobile]}>
                Please input your Canada Gold, CDN Coin, or other company email.
              </Text>
              <View style={[styles.fields, isMobile && styles.fieldsMobile]}>
                <View style={[styles.fieldRow, isMobile && styles.fieldRowMobile]}>
                  <Ionicons
                    name="mail-outline"
                    size={isMobile ? 20 : 16}
                    color={ICON}
                    style={styles.fieldIcon}
                  />
                  <TextInput
                    style={[styles.input, isMobile && styles.inputMobile]}
                    value={joinEmail}
                    onChangeText={onChangeJoinEmail}
                    placeholder="name@canadagold.ca"
                    placeholderTextColor="#8e8e93"
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="email-address"
                    textContentType="emailAddress"
                    editable={!joinSubmitting}
                    returnKeyType="done"
                    onSubmitEditing={() => {
                      if (canJoin) onSubmitJoin();
                    }}
                  />
                </View>
              </View>
              {joinError ? (
                <Text style={[styles.errorText, isMobile && styles.errorTextMobile]}>{joinError}</Text>
              ) : null}
              <Pressable
                style={[styles.button, isMobile && styles.buttonMobile, !canJoin && styles.buttonDisabled]}
                onPress={onSubmitJoin}
                disabled={!canJoin}
              >
                {joinSubmitting ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={[styles.buttonText, isMobile && styles.buttonTextMobile]}>Done</Text>
                )}
              </Pressable>
              <Pressable style={styles.textButton} onPress={onBackToLogin} disabled={joinSubmitting}>
                <Text style={[styles.textButtonText, isMobile && styles.textButtonTextMobile]}>Back</Text>
              </Pressable>
            </>
          ) : null}

          {mode === 'sent' ? (
            <>
              <Text style={[styles.prompt, isMobile && styles.promptMobile]}>
                A temporary password has been sent to your email.
              </Text>
              <Text style={[styles.hint, isMobile && styles.hintMobile]}>
                Open that email, then log in here with your email and the temporary password.
              </Text>
              <Pressable style={[styles.button, isMobile && styles.buttonMobile]} onPress={onBackToLogin}>
                <Text style={[styles.buttonText, isMobile && styles.buttonTextMobile]}>Log in</Text>
              </Pressable>
            </>
          ) : null}

          {mode === 'set-password' ? (
            <>
              <Text style={[styles.prompt, isMobile && styles.promptMobile]}>Choose a password</Text>
              <Text style={[styles.hint, isMobile && styles.hintMobile]}>
                At least 12 characters, with an uppercase letter, a lowercase letter, and a number.
              </Text>
              <View style={[styles.fields, isMobile && styles.fieldsMobile]}>
                <View style={[styles.fieldRow, isMobile && styles.fieldRowMobile]}>
                  <Ionicons
                    name="lock-closed-outline"
                    size={isMobile ? 20 : 16}
                    color={ICON}
                    style={styles.fieldIcon}
                  />
                  <TextInput
                    style={[styles.input, isMobile && styles.inputMobile]}
                    value={newPassword}
                    onChangeText={onChangeNewPassword}
                    placeholder="Password"
                    placeholderTextColor="#8e8e93"
                    secureTextEntry
                    textContentType="newPassword"
                    editable={!passwordSubmitting}
                    returnKeyType="next"
                  />
                </View>
                <View style={[styles.fieldDivider, isMobile && styles.fieldDividerMobile]} />
                <View style={[styles.fieldRow, isMobile && styles.fieldRowMobile]}>
                  <Ionicons
                    name="lock-closed-outline"
                    size={isMobile ? 20 : 16}
                    color={ICON}
                    style={styles.fieldIcon}
                  />
                  <TextInput
                    style={[styles.input, isMobile && styles.inputMobile]}
                    value={repeatPassword}
                    onChangeText={onChangeRepeatPassword}
                    placeholder="Repeat password"
                    placeholderTextColor="#8e8e93"
                    secureTextEntry
                    textContentType="newPassword"
                    editable={!passwordSubmitting}
                    returnKeyType="done"
                    onSubmitEditing={() => {
                      if (canSetPassword) onSubmitNewPassword();
                    }}
                  />
                </View>
              </View>
              {passwordError ? (
                <Text style={[styles.errorText, isMobile && styles.errorTextMobile]}>{passwordError}</Text>
              ) : null}
              <Pressable
                style={[
                  styles.button,
                  isMobile && styles.buttonMobile,
                  !canSetPassword && styles.buttonDisabled,
                ]}
                onPress={onSubmitNewPassword}
                disabled={!canSetPassword}
              >
                {passwordSubmitting ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={[styles.buttonText, isMobile && styles.buttonTextMobile]}>Done</Text>
                )}
              </Pressable>
              <Pressable style={styles.textButton} onPress={onCancelPassword} disabled={passwordSubmitting}>
                <Text style={[styles.textButtonText, isMobile && styles.textButtonTextMobile]}>Back</Text>
              </Pressable>
            </>
          ) : null}

          {mode === 'login' ? (
          <>
          <View style={[styles.fields, isMobile && styles.fieldsMobile]}>
            <View style={[styles.fieldRow, isMobile && styles.fieldRowMobile]}>
              <Ionicons
                name="mail-outline"
                size={isMobile ? 20 : 16}
                color={ICON}
                style={styles.fieldIcon}
              />
              <TextInput
                style={[styles.input, isMobile && styles.inputMobile]}
                value={loginId}
                onChangeText={onChangeLoginId}
                placeholder="Email or User Id"
                placeholderTextColor="#8e8e93"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                textContentType="username"
                editable={!submitting}
                returnKeyType="next"
              />
            </View>
            <View style={[styles.fieldDivider, isMobile && styles.fieldDividerMobile]} />
            <View style={[styles.fieldRow, isMobile && styles.fieldRowMobile]}>
              <Ionicons
                name="lock-closed-outline"
                size={isMobile ? 20 : 16}
                color={ICON}
                style={styles.fieldIcon}
              />
              <TextInput
                style={[styles.input, isMobile && styles.inputMobile]}
                value={password}
                onChangeText={onChangePassword}
                placeholder="Password"
                placeholderTextColor="#8e8e93"
                secureTextEntry
                textContentType="password"
                editable={!submitting}
                returnKeyType="done"
                onSubmitEditing={() => {
                  if (canSubmit) onSubmit();
                }}
              />
            </View>
          </View>

          {error ? <Text style={[styles.errorText, isMobile && styles.errorTextMobile]}>{error}</Text> : null}

          <Pressable
            style={[
              styles.button,
              isMobile && styles.buttonMobile,
              !canSubmit && styles.buttonDisabled,
            ]}
            onPress={onSubmit}
            disabled={!canSubmit}
          >
            {submitting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <View style={styles.buttonInner}>
                <Ionicons
                  name="log-in-outline"
                  size={isMobile ? 20 : 16}
                  color="#fff"
                  style={styles.fieldIcon}
                />
                <Text style={[styles.buttonText, isMobile && styles.buttonTextMobile]}>Log in</Text>
              </View>
            )}
          </Pressable>
          <Pressable
            style={[styles.secondaryButton, isMobile && styles.secondaryButtonMobile]}
            onPress={onJoin}
            disabled={submitting}
          >
            <Text style={[styles.secondaryButtonText, isMobile && styles.secondaryButtonTextMobile]}>Join</Text>
          </Pressable>
          </>
          ) : null}
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
    marginBottom: 120,
  },
  logoSlotMobile: {
    marginBottom: 108,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    zIndex: 1,
  },
  cardMobile: {
    maxWidth: 400,
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
  fields: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#d0d0d0',
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#fff',
  },
  fieldsMobile: {
    borderRadius: 12,
    borderColor: 'rgba(60,60,67,0.18)',
  },
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 12,
  },
  fieldRowMobile: {
    paddingLeft: 14,
  },
  fieldIcon: {
    marginRight: 8,
  },
  input: {
    fontFamily,
    flex: 1,
    fontSize: 13,
    color: '#1a1a1a',
    paddingRight: 12,
    paddingVertical: 12,
    outlineStyle: 'none',
  },
  inputMobile: {
    fontSize: 17,
    paddingRight: 16,
    paddingVertical: 14,
    color: '#1d1d1f',
  },
  fieldDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#d0d0d0',
    marginLeft: 36,
  },
  fieldDividerMobile: {
    backgroundColor: 'rgba(60,60,67,0.18)',
    marginLeft: 42,
  },
  errorText: {
    fontFamily,
    fontSize: 12,
    color: '#b42318',
    marginTop: 12,
  },
  errorTextMobile: {
    fontSize: 13,
    textAlign: 'center',
  },
  button: {
    marginTop: 16,
    backgroundColor: '#1a1a1a',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    alignItems: 'center',
    minHeight: 40,
    justifyContent: 'center',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  buttonMobile: {
    marginTop: 20,
    borderRadius: 12,
    minHeight: 50,
    paddingVertical: 14,
    paddingHorizontal: 14,
  },
  buttonInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  buttonText: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: '#fff',
  },
  buttonTextMobile: {
    fontSize: 17,
    fontWeight: '600',
  },
  secondaryButton: {
    marginTop: 10,
    backgroundColor: '#fff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#d0d0d0',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    alignItems: 'center',
    minHeight: 40,
    justifyContent: 'center',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  secondaryButtonMobile: {
    marginTop: 12,
    borderRadius: 12,
    minHeight: 50,
    paddingVertical: 14,
    borderColor: 'rgba(60,60,67,0.18)',
  },
  secondaryButtonText: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  secondaryButtonTextMobile: {
    fontSize: 17,
  },
  prompt: {
    fontFamily,
    fontSize: 15,
    lineHeight: 21,
    color: '#1a1a1a',
    textAlign: 'center',
    marginBottom: 16,
  },
  promptMobile: {
    fontSize: 17,
    lineHeight: 24,
    marginBottom: 20,
  },
  hint: {
    fontFamily,
    fontSize: 13,
    lineHeight: 18,
    color: '#636366',
    textAlign: 'center',
    marginTop: -8,
    marginBottom: 4,
  },
  hintMobile: {
    fontSize: 15,
    lineHeight: 21,
  },
  textButton: {
    marginTop: 14,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 36,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  textButtonText: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  textButtonTextMobile: {
    fontSize: 17,
  },
});
