import { lazy, Suspense } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { CANVAS, useIsMobile } from '../lib/mobileUi';
import { EmptyState } from './TriageKit';

const AnalyticsAiPanel = lazy(() => import('./AnalyticsAiPanel'));

// Opening Analytics always lands on a new chat. Earlier conversations stay
// in the sidebar and are loaded from this device plus shared AI threads.
export default function AnalyticsScreen({
  session,
  storeFilter,
  onOpenCustomer,
  onOpenDocument,
  onMobileHeader,
  onOpenDashboard,
}) {
  const compact = useIsMobile();

  if (!session?.token) {
    return (
      <View style={[styles.screen, compact && styles.screenPhone]}>
        <EmptyState icon="sparkles-outline" title="Analytics" body="Sign in to ask questions about store activity." />
      </View>
    );
  }

  return (
    <View style={[styles.screen, compact && styles.screenPhone]}>
      <Suspense
        fallback={
          <View style={styles.fallback}>
            <ActivityIndicator color="#1a1a1a" />
          </View>
        }
      >
        <AnalyticsAiPanel
          session={session}
          compact={compact}
          onOpenCustomer={onOpenCustomer}
          onOpenDocument={onOpenDocument}
          storeFilter={storeFilter}
          onMobileHeader={onMobileHeader}
          onOpenDashboard={onOpenDashboard}
        />
      </Suspense>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    minHeight: 0,
    backgroundColor: CANVAS,
  },
  screenPhone: {
    backgroundColor: CANVAS,
  },
  fallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
