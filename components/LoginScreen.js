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
import { useIsMobile } from '../lib/mobileUi';
import { MobileSafeTop } from './MobileChrome';

const fontFamily = 'Sohne';

export default function LoginScreen({
  loginId,
  password,
  error,
  submitting,
  onChangeLoginId,
  onChangePassword,
  onSubmit,
}) {
  const isMobile = useIsMobile();
  const canSubmit = Boolean(loginId.trim() && password.trim() && !submitting);

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
          <View style={[styles.fields, isMobile && styles.fieldsMobile]}>
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
            <View style={[styles.fieldDivider, isMobile && styles.fieldDividerMobile]} />
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
              <Text style={[styles.buttonText, isMobile && styles.buttonTextMobile]}>Log in</Text>
            )}
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  pageMobile: {
    justifyContent: 'flex-start',
    paddingHorizontal: 0,
    backgroundColor: '#f2f2f7',
  },
  inner: {
    width: '100%',
    alignItems: 'center',
  },
  innerMobile: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 28,
    paddingBottom: 48,
  },
  logoSlot: {
    width: '100%',
    alignItems: 'center',
    marginBottom: 36,
  },
  logoSlotMobile: {
    marginBottom: 28,
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
    width: 112,
    height: 112,
    borderRadius: 56,
    overflow: 'hidden',
  },
  logoMobile: {
    width: 96,
    height: 96,
    borderRadius: 48,
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
  input: {
    fontFamily,
    fontSize: 13,
    color: '#1a1a1a',
    paddingHorizontal: 12,
    paddingVertical: 12,
    outlineStyle: 'none',
  },
  inputMobile: {
    fontSize: 17,
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: '#1d1d1f',
  },
  fieldDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#d0d0d0',
  },
  fieldDividerMobile: {
    backgroundColor: 'rgba(60,60,67,0.18)',
    marginLeft: 16,
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
    borderRadius: 14,
    minHeight: 50,
    paddingVertical: 14,
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
});
