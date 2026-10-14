import { Image, Platform, StyleSheet, Text, View } from 'react-native';

const fontFamily = Platform.select({
  ios: 'Sohne',
  android: 'Sohne',
  default: 'Sohne',
});

const TROVE_LOGO = require('../assets/trove-logo.png');
const LOGO_ASPECT = 3.85;
const LOGO_HEIGHT = 36;
const LOGO_WIDTH = Math.round(LOGO_HEIGHT * LOGO_ASPECT);

export default function TroveScreen() {
  return (
    <View style={styles.screen}>
      <View style={styles.emptyPanel}>
        <View style={styles.logoFrame}>
          <Image
            source={TROVE_LOGO}
            style={styles.logo}
            resizeMode="contain"
            accessibilityIgnoresInvertColors
          />
        </View>
        <Text style={styles.emptyBody}>Collections and saved finds will live here.</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#fff',
  },
  emptyPanel: {
    flex: 1,
    minHeight: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingBottom: 48,
  },
  logoFrame: {
    width: LOGO_WIDTH + 28,
    height: LOGO_HEIGHT + 16,
    borderRadius: 12,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    ...Platform.select({
      web: {
        boxShadow: '0 1px 1px rgba(0,0,0,0.06), 0 8px 18px rgba(0,0,0,0.12)',
      },
      default: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.14,
        shadowRadius: 10,
        elevation: 4,
      },
    }),
  },
  logo: {
    width: LOGO_WIDTH,
    height: LOGO_HEIGHT,
  },
  emptyBody: {
    fontFamily,
    fontSize: 15,
    lineHeight: 21,
    color: '#6b6b6b',
    textAlign: 'center',
    maxWidth: 320,
  },
});
