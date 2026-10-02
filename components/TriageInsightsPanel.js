import { useEffect, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  collectAccuracyTriagePos,
  summarizeTriageInsights,
  summarizeTriageInsightsByPerson,
  syncTransferWorkflowRemote,
  triageRowMatchesStore,
  useTransferWorkflow,
} from '../lib/transferWorkflow';
import { CANVAS, useIsMobile } from '../lib/mobileUi';
import { ChromeHero, ChromeListRow, ChromePage, EmptyState, FONT, T, TextAction } from './TriageKit';

const fontFamily = FONT;

function reviewedLabel(total) {
  return `${total} reviewed ${total === 1 ? 'purchase' : 'purchases'}`;
}

function InsightMetrics({ correct, incorrect, percent }) {
  return (
    <View style={styles.metrics}>
      <Text style={[styles.metric, styles.metricCorrect]}>{correct}</Text>
      <Text style={[styles.metric, styles.metricIncorrect]}>{incorrect}</Text>
      <Text style={styles.metric}>{percent}%</Text>
    </View>
  );
}

export default function TriageInsightsPanel({ session, storeFilter, onRequireLogin }) {
  const isMobile = useIsMobile();
  const { triage } = useTransferWorkflow();

  useEffect(() => {
    if (!session?.supabaseUserId && !session?.token) return undefined;
    syncTransferWorkflowRemote().catch(() => {});
    return undefined;
  }, [session?.supabaseUserId, session?.token]);

  const rows = useMemo(
    () => collectAccuracyTriagePos(triage).filter((row) => triageRowMatchesStore(row, storeFilter)),
    [storeFilter, triage],
  );
  const stats = useMemo(() => summarizeTriageInsights(rows), [rows]);
  const people = useMemo(() => summarizeTriageInsightsByPerson(rows), [rows]);

  if (!session?.token) {
    return (
      <View style={[styles.body, isMobile && styles.bodyMobile]}>
        <EmptyState
          icon="lock-closed-outline"
          title="Sign in to triage"
          body="Log in to see reviewed purchases for this store."
          action={onRequireLogin ? <TextAction label="Go to Profile" strong onPress={onRequireLogin} /> : null}
        />
      </View>
    );
  }

  return (
    <View style={[styles.body, isMobile && styles.bodyMobile]}>
      <ChromePage
        hero={
          <ChromeHero
            value={stats.total ? `${stats.percent}%` : '—'}
            stats={[
              { label: 'Correct', value: String(stats.correct) },
              { label: 'Incorrect', value: String(stats.incorrect) },
              { label: 'Reviewed', value: String(stats.total) },
            ]}
          />
        }
        title="Triage insights"
        meta={stats.total ? reviewedLabel(stats.total) : 'No reviewed purchases'}
      >
        <View style={styles.head}>
          <Text style={[styles.headCell, styles.headPerson]}>Person</Text>
          <Text style={[styles.headCell, styles.headNum]}>Correct</Text>
          <Text style={[styles.headCell, styles.headNum]}>Incorrect</Text>
          <Text style={[styles.headCell, styles.headNum]}>Accuracy</Text>
        </View>
        {people.length ? (
          people.map((row, index) => (
            <ChromeListRow
              key={row.name}
              title={row.name}
              meta={reviewedLabel(row.total)}
              icon="person"
              iconColor="#6B7280"
              last={index === people.length - 1}
              chevron={false}
              trailing={<InsightMetrics correct={row.correct} incorrect={row.incorrect} percent={row.percent} />}
            />
          ))
        ) : (
          <Text style={styles.empty}>
            {storeFilter
              ? `No reviewed purchases at ${storeFilter} yet.`
              : 'No reviewed purchases yet.'}
          </Text>
        )}
      </ChromePage>
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
    minHeight: 0,
    backgroundColor: T.bg,
  },
  bodyMobile: {
    backgroundColor: CANVAS,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 74,
    paddingRight: 34,
    paddingTop: 10,
    paddingBottom: 8,
    backgroundColor: '#fff',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: T.hairline,
  },
  headCell: {
    fontFamily,
    fontSize: 11,
    fontWeight: '600',
    color: T.secondary,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  headPerson: {
    flex: 1,
    minWidth: 0,
  },
  headNum: {
    width: 72,
    textAlign: 'right',
  },
  metrics: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 0,
  },
  metric: {
    fontFamily,
    width: 72,
    textAlign: 'right',
    fontSize: 15,
    fontWeight: '600',
    color: T.text,
    fontVariant: ['tabular-nums'],
  },
  metricCorrect: {
    color: T.green,
  },
  metricIncorrect: {
    color: T.red,
  },
  empty: {
    fontFamily,
    fontSize: 15,
    lineHeight: 20,
    color: '#8e8e93',
    paddingHorizontal: 16,
    paddingVertical: 18,
    backgroundColor: '#fff',
  },
});
