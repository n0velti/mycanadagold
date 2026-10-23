import { Component, Suspense } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { FONT } from '../lib/typography';

/** Shown in place of a screen while its chunk is still downloading. */
export function ScreenFallback() {
  return (
    <View style={styles.centered}>
      <ActivityIndicator color="#1a1a1a" />
    </View>
  );
}

function reloadPage() {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return;
  window.location.reload();
}

/**
 * Catches a screen that failed to load or render so the rest of the shell
 * (sidebar, Home) stays up. Search, Messages, Profile, and every app in the
 * grid are lazy; a throw here used to call location.replace and boot the
 * person back on Home. Keep them on this tab and let them reload if they want.
 */
class ScreenBoundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidUpdate(prevProps) {
    if (this.state.failed && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ failed: false });
    }
  }

  componentDidCatch(error, info) {
    if (typeof console !== 'undefined' && console.error) {
      console.error('[ScreenGate]', this.props.resetKey || 'screen', error, info?.componentStack);
    }
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <View style={styles.centered}>
        <Text style={styles.message}>This screen could not be loaded.</Text>
        {Platform.OS === 'web' ? (
          <Pressable accessibilityRole="button" onPress={reloadPage} style={styles.reloadButton}>
            <Text style={styles.reloadLabel}>Reload</Text>
          </Pressable>
        ) : null}
      </View>
    );
  }
}

/** Suspense + error boundary for a lazily loaded screen. */
export default function ScreenGate({ resetKey, children }) {
  return (
    <ScreenBoundary resetKey={resetKey}>
      <Suspense fallback={<ScreenFallback />}>{children}</Suspense>
    </ScreenBoundary>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  message: {
    fontFamily: FONT,
    fontSize: 15,
    color: '#8e8e93',
    marginTop: 48,
    width: '100%',
    alignSelf: 'center',
    textAlign: 'center',
  },
  reloadButton: {
    marginTop: 16,
    paddingHorizontal: 18,
    paddingVertical: 9,
    borderRadius: 8,
    backgroundColor: '#1a1a1a',
  },
  reloadLabel: {
    fontFamily: FONT,
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
});
