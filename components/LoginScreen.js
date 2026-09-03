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
  const canSubmit = Boolean(loginId.trim() && password.trim() && !submitting);

  return (
    <View style={styles.page}>
      <View style={styles.logoSlot} pointerEvents="none">
        <View style={styles.logoWrap}>
          <Image
            source={require('../assets/canada-gold-logo.png')}
            style={styles.logo}
            resizeMode="contain"
            accessibilityLabel="Canada Gold"
          />
        </View>
      </View>

      <View style={styles.card}>
        <View style={styles.fields}>
          <TextInput
            style={styles.input}
            value={loginId}
            onChangeText={onChangeLoginId}
            placeholder="Email or User Id"
            placeholderTextColor="#999"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="username"
            editable={!submitting}
            returnKeyType="next"
          />
          <View style={styles.fieldDivider} />
          <TextInput
            style={styles.input}
            value={password}
            onChangeText={onChangePassword}
            placeholder="Password"
            placeholderTextColor="#999"
            secureTextEntry
            textContentType="password"
            editable={!submitting}
            returnKeyType="done"
            onSubmitEditing={() => {
              if (canSubmit) onSubmit();
            }}
          />
        </View>

        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        <Pressable
          style={[styles.button, !canSubmit && styles.buttonDisabled]}
          onPress={onSubmit}
          disabled={!canSubmit}
        >
          {submitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Log in</Text>
          )}
        </Pressable>
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
  logoSlot: {
    width: '100%',
    alignItems: 'center',
    marginBottom: 48,
  },
  logoWrap: {
    width: '100%',
    maxWidth: 340,
    aspectRatio: 800 / 157,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    zIndex: 1,
  },
  logo: {
    width: '100%',
    height: '100%',
  },
  fields: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#d0d0d0',
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#fff',
  },
  input: {
    fontFamily,
    fontSize: 13,
    color: '#1a1a1a',
    paddingHorizontal: 12,
    paddingVertical: 12,
    outlineStyle: 'none',
  },
  fieldDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#d0d0d0',
  },
  errorText: {
    fontFamily,
    fontSize: 12,
    color: '#b42318',
    marginTop: 12,
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
  buttonDisabled: {
    opacity: 0.7,
  },
  buttonText: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: '#fff',
  },
});
