import { Image, Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

const fontFamily = Platform.select({
  ios: 'Sohne',
  android: 'Sohne',
  default: 'Sohne',
});

const TINT = '#FFF7ED';
const ACCENT = '#B45309';
const TROVE_APP_ICON = require('../assets/trove-app-icon.jpg');
const TROVE_URL = 'https://gold-pos-staging.up.railway.app/login';

function openTrove() {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    window.open(TROVE_URL, '_blank', 'noopener,noreferrer');
    return;
  }
  void Linking.openURL(TROVE_URL);
}

export default function TroveScreen({ onOpen }) {
  const open = onOpen || openTrove;

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
        <Text style={styles.emptyBody}>Buy and sell in Trove.</Text>
        <Pressable
          onPress={open}
          accessibilityRole="link"
          accessibilityLabel="Open Trove"
          accessibilityHint="Opens Trove in a new tab"
          style={({ hovered, pressed }) => [
            styles.openButton,
            (hovered || pressed) && styles.openButtonHover,
          ]}
        >
          <Text style={styles.openButtonLabel}>Open Trove</Text>
        </Pressable>
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
    marginBottom: 18,
  },
  openButton: {
    minHeight: 40,
    paddingHorizontal: 16,
    borderRadius: 10,
    backgroundColor: ACCENT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  openButtonHover: {
    opacity: 0.9,
  },
  openButtonLabel: {
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
  },
});
