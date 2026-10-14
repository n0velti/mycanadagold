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

/**
 * Catches a screen that failed to load or render. The usual cause is a chunk
 * that no longer exists because a new version was deployed while this tab
 * stayed open; reloading picks up the new build. Without this, the failure
 * would unmount the whole app.
 */
function reloadFreshScreen() {
  const url = new URL(window.location.href);
  url.searchParams.set('screen', String(Date.now()));
  window.location.replace(url.toString());
}

class ScreenBoundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidUpdate(prevProps) {
    if (this.state.failed && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ failed: false });
      return;
    }
    this.clearReloadFlag();
  }

  componentDidCatch() {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    try {
      if (sessionStorage.getItem('cgold-screen-reload')) return;
      sessionStorage.setItem('cgold-screen-reload', '1');
    } catch {
      return;
    }
    reloadFreshScreen();
  }

  clearReloadFlag() {
    // Only after a committed successful screen. Clearing on mount used to run
    // while Suspense still showed the fallback; the lazy screen then threw,
    // we reloaded, cgold-open-tool restored the same app, and the tab looped.
    if (this.state.failed || Platform.OS !== 'web') return;
    try {
      sessionStorage.removeItem('cgold-screen-reload');
    } catch {
      /* ignore */
    }
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <View style={styles.centered}>
        <Text style={styles.message}>This screen could not be loaded.</Text>
        {Platform.OS === 'web' ? (
          <Pressable accessibilityRole="button" onPress={reloadFreshScreen} style={styles.reloadButton}>
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
