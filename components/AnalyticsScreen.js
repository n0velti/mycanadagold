import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import {
  factsFromTimeEntries,
  factsFromTransactions,
  listTriageErrorFacts,
  pivotFacts,
} from '../lib/employeeMetrics';
import { listStaffProfiles } from '../lib/permissions';
import { CANVAS, useIsMobile } from '../lib/mobileUi';
import { defaultDateRange, fetchTransactionsAcrossPos } from '../lib/transactions';
import { fetchTimeEntriesBetween } from '../lib/ripplingTime';
import { EmptyState } from './TriageKit';

const AnalyticsAiPanel = lazy(() => import('./AnalyticsAiPanel'));

function AnalyticsBody({ session, storeFilter, onOpenCustomer, onOpenDocument }) {
  const compact = useIsMobile();
  const range = defaultDateRange(7);
  const [startDate] = useState(range.startDate);
  const [endDate] = useState(range.endDate);
  const groupBy = 'employee';
  const measure = 'transactions';
  const [staff, setStaff] = useState([]);
  const [rows, setRows] = useState([]);
  const [errorFacts, setErrorFacts] = useState([]);
  const [timeRows, setTimeRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const requestId = useRef(0);

  const load = useCallback(async () => {
    if (!session?.token) {
      setRows([]);
      setErrorFacts([]);
      setTimeRows([]);
      setError('');
      setWarning('');
      return;
    }
    const id = ++requestId.current;
    setLoading(true);
    setError('');
    try {
      const [tx, people, punches] = await Promise.all([
        fetchTransactionsAcrossPos(session, { startDate, endDate, includePurchases: true }),
        listStaffProfiles().catch(() => []),
        fetchTimeEntriesBetween(startDate, endDate).catch(() => []),
      ]);
      if (id !== requestId.current) return;
      const staffRows = Array.isArray(people) ? people : [];
      const mistakes = await listTriageErrorFacts(staffRows, { startDate, endDate }).catch(() => []);
      if (id !== requestId.current) return;
      setRows(tx.rows || []);
      setStaff(staffRows);
      setErrorFacts(Array.isArray(mistakes) ? mistakes : []);
      setTimeRows(Array.isArray(punches) ? punches : []);
      setWarning(tx.warning || '');
    } catch (err) {
      if (id !== requestId.current) return;
      setRows([]);
      setErrorFacts([]);
      setTimeRows([]);
      setError(err?.message || 'Could not load employee activity.');
      setWarning('');
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [session, startDate, endDate]);

  useEffect(() => {
    load();
  }, [load]);

  const facts = useMemo(() => {
    const sales = factsFromTransactions(rows, staff, { storeFilter });
    const hours = factsFromTimeEntries(timeRows, staff, { storeFilter, sales });
    const lock = String(storeFilter || '').trim();
    const mistakes = lock
      ? errorFacts.filter(
          (fact) =>
            !fact.store ||
            fact.store === '—' ||
            fact.store.localeCompare(lock, undefined, { sensitivity: 'base' }) === 0,
        )
      : errorFacts;
    return [...sales, ...hours, ...mistakes];
  }, [rows, staff, storeFilter, errorFacts, timeRows]);

  const pivot = useMemo(() => pivotFacts(facts, { groupBy, measure }), [facts, groupBy, measure]);

  return (
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
        startDate={startDate}
        endDate={endDate}
        groupBy={groupBy}
        measure={measure}
        storeFilter={storeFilter}
        pivot={pivot}
        rows={rows}
        eventCount={facts.length}
        loading={loading}
        dataError={error}
        warning={warning}
      />
    </Suspense>
  );
}

export default function AnalyticsScreen({ session, storeFilter, onOpenCustomer, onOpenDocument }) {
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
      <AnalyticsBody
        session={session}
        storeFilter={storeFilter}
        onOpenCustomer={onOpenCustomer}
        onOpenDocument={onOpenDocument}
      />
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
