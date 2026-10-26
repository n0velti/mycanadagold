import { Component, Suspense } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { FONT } from '../lib/typography';

const STALE_CHUNK_RELOAD_KEY = 'cgold-stale-chunk-reload';
const STALE_CHUNK_RELOAD_COOLDOWN_MS = 20_000;

/** Metro / webpack messages when a hashed lazy file is gone after a deploy. */
export function isStaleChunkError(error) {
  const name = error?.name || '';
  const message = String(error?.message || error || '');
  return (
    name === 'ChunkLoadError' ||
    /Loading module /i.test(message) ||
    /Failed to fetch dynamically imported module/i.test(message) ||
    /error loading dynamically imported module/i.test(message) ||
    /Importing a module script failed/i.test(message)
  );
}

function staleChunkReloadedRecently() {
  if (typeof window === 'undefined') return false;
  try {
    const prev = Number(window.sessionStorage.getItem(STALE_CHUNK_RELOAD_KEY) || 0);
    return Boolean(prev && Date.now() - prev < STALE_CHUNK_RELOAD_COOLDOWN_MS);
  } catch {
    return Boolean(window.__cgoldStaleChunkReloaded);
  }
}

/** One page reload so a tab left open across a deploy picks up the new hashes. */
export function reloadForStaleChunk(error, reopenKey) {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return false;
  if (error && !isStaleChunkError(error)) return false;
  if (staleChunkReloadedRecently()) return false;
  try {
    window.sessionStorage.setItem(STALE_CHUNK_RELOAD_KEY, String(Date.now()));
    if (reopenKey && reopenKey !== 'home' && reopenKey !== 'self') {
      window.sessionStorage.setItem('cgold-open-tool', reopenKey);
    }
  } catch {
    window.__cgoldStaleChunkReloaded = true;
  }
  window.location.reload();
  return true;
}

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
 * grid are lazy. A missing hashed file after a deploy reloads the page once
 * so this tab picks up the new bundle; any other throw stays here.
 */
class ScreenBoundary extends Component {
  state = { failed: false, error: null, retry: 0, reloading: false };

  static getDerivedStateFromError(error) {
    return {
      failed: true,
      error,
      reloading: Platform.OS === 'web' && isStaleChunkError(error) && !staleChunkReloadedRecently(),
    };
  }

  componentDidUpdate(prevProps) {
    if (this.state.failed && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ failed: false, error: null, reloading: false });
    }
  }

  retry = () => {
    this.setState((state) => ({ failed: false, error: null, reloading: false, retry: state.retry + 1 }));
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
    if (this.state.reloading) reloadForStaleChunk(error, this.props.resetKey);
  }

  render() {
    if (this.state.reloading) {
      return <ScreenFallback />;
    }
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
