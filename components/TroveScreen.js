import { Image, Platform, StyleSheet, Text, View } from 'react-native';

const fontFamily = Platform.select({
  ios: 'Sohne',
  android: 'Sohne',
  default: 'Sohne',
});

const TINT = '#FFF7ED';
const TROVE_APP_ICON = require('../assets/trove-app-icon.jpg');

export default function TroveScreen() {
  return (
    <View style={styles.screen}>
      <View style={styles.emptyPanel}>
        <View style={styles.emptyIcon}>
          <Image
            source={TROVE_APP_ICON}
            style={styles.emptyLogo}
            resizeMode="cover"
            accessibilityIgnoresInvertColors
          />
        </View>
        <Text style={styles.emptyTitle}>Trove</Text>
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
  emptyIcon: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: TINT,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
    overflow: 'hidden',
  },
  emptyLogo: {
    width: 42,
    height: 42,
    borderRadius: 11,
  },
  emptyTitle: {
    fontFamily,
    fontSize: 20,
    fontWeight: '600',
    color: '#1a1a1a',
    letterSpacing: -0.3,
    marginBottom: 6,
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
