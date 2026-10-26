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
  state = { failed: false, error: null, retry: 0 };

  static getDerivedStateFromError(error) {
    return { failed: true, error };
  }

  componentDidUpdate(prevProps) {
    if (this.state.failed && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ failed: false, error: null });
    }
  }

  retry = () => {
    this.setState((state) => ({ failed: false, error: null, retry: state.retry + 1 }));
  };

  componentDidCatch(error, info) {
    if (typeof console !== 'undefined' && console.error) {
      console.error('[ScreenGate]', this.props.resetKey || 'screen', error, info?.componentStack);
    }
    if (typeof window !== 'undefined') {
      window.__lastScreenGateError = {
        key: this.props.resetKey || 'screen',
        message: error?.message || String(error),
        stack: error?.stack || '',
        componentStack: info?.componentStack || '',
      };
    }
  }

  render() {
    if (!this.state.failed) {
      return <Suspense key={this.state.retry} fallback={<ScreenFallback />}>{this.props.children}</Suspense>;
    }
    const detail = this.state.error?.message || this.state.error?.toString?.();
    return (
      <View style={styles.centered}>
        <Text style={styles.message}>This screen could not be loaded.</Text>
        {detail ? <Text style={styles.detail}>{detail}</Text> : null}
        <Pressable accessibilityRole="button" onPress={this.retry} style={styles.reloadButton}>
          <Text style={styles.reloadLabel}>Try again</Text>
        </Pressable>
        {Platform.OS === 'web' ? (
          <Pressable accessibilityRole="button" onPress={reloadPage} style={styles.retryQuiet}>
            <Text style={styles.retryQuietLabel}>Reload the page</Text>
          </Pressable>
        ) : null}
      </View>
    );
  }
}

/** Error boundary for a lazily loaded screen. Suspense lives inside so Try again remounts the chunk. */
export default function ScreenGate({ resetKey, children }) {
  return <ScreenBoundary resetKey={resetKey}>{children}</ScreenBoundary>;
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
  detail: {
    fontFamily: FONT,
    fontSize: 13,
    color: '#aeaeae',
    marginTop: 10,
    maxWidth: 520,
    paddingHorizontal: 24,
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
  retryQuiet: {
    marginTop: 10,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  retryQuietLabel: {
    fontFamily: FONT,
    fontSize: 13,
    color: '#8e8e93',
  },
});
