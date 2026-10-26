/**
 * Dev-only eval runner for the Analytics assistant. Mounted from the model
 * sheet when __DEV__ is true; never part of a production bundle. Runs the
 * cases in lib/aiEval.js against the signed-in session and lists which
 * checks passed, failed, or need a human to compare against the app.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { buildEvalCases, runAiEvals, summarizeEvalResults } from '../lib/aiEval';

const INK = '#1a1a1a';
const MUTED = '#8e8e93';
const STATUS_COLORS = { pass: '#1f8a4c', fail: '#c62828', review: '#b26a00', error: '#6a1b9a' };

export default function AiEvalPanel({ visible, onClose, session, model }) {
  const cases = useMemo(() => buildEvalCases(), []);
  const groups = useMemo(() => [...new Set(cases.map((item) => item.group))], [cases]);
  const [group, setGroup] = useState('');
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState([]);
  const [progress, setProgress] = useState('');
  const [open, setOpen] = useState('');
  const abortRef = useRef(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const selected = group ? cases.filter((item) => item.group === group) : cases;
  const summary = summarizeEvalResults(results);

  const start = async () => {
    if (running) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setResults([]);
    setProgress(`0 of ${selected.length}`);
    try {
      await runAiEvals({
        session,
        model,
        cases: selected,
        signal: controller.signal,
        onProgress: (row, done, total) => {
          setResults((current) => [...current, row]);
          setProgress(`${done} of ${total}`);
        },
      });
    } finally {
      setRunning(false);
      setProgress('');
    }
  };

  const stop = () => abortRef.current?.abort();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close evals" />
        <View style={styles.card}>
          <View style={styles.head}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>AI evals</Text>
              <Text style={styles.subtitle}>
                {selected.length} cases · {model}
                {results.length ? ` · ${summary.pass} pass, ${summary.fail} fail, ${summary.review} review${summary.error ? `, ${summary.error} error` : ''}` : ''}
              </Text>
            </View>
            <Pressable onPress={onClose} accessibilityRole="button" style={styles.iconButton}>
              <Ionicons name="close" size={18} color={INK} />
            </Pressable>
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips} contentContainerStyle={styles.chipsContent}>
            {['', ...groups].map((key) => (
              <Pressable key={key || 'all'} onPress={() => setGroup(key)} style={[styles.chip, group === key && styles.chipOn]} accessibilityRole="button">
                <Text style={[styles.chipText, group === key && styles.chipTextOn]}>{key || 'All'}</Text>
              </Pressable>
            ))}
          </ScrollView>

          <View style={styles.actions}>
            <Pressable onPress={running ? stop : start} style={[styles.run, running && styles.runStop]} accessibilityRole="button">
              {running ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="play" size={14} color="#fff" />}
              <Text style={styles.runText}>{running ? `Stop · ${progress}` : 'Run'}</Text>
            </Pressable>
            <Text style={styles.hint}>Each case spends real AI credits. Review items need a human to compare with the app.</Text>
          </View>

          <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
            {results.map((row) => {
              const expanded = open === row.id;
              return (
                <View key={row.id} style={styles.row}>
                  <Pressable onPress={() => setOpen(expanded ? '' : row.id)} style={styles.rowHead} accessibilityRole="button">
                    <View style={[styles.dot, { backgroundColor: STATUS_COLORS[row.status] || MUTED }]} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.rowTitle} numberOfLines={expanded ? undefined : 1}>
                        {row.question}
                      </Text>
                      <Text style={styles.rowMeta}>
                        {row.group} · {row.status} · {row.tools.join(', ') || 'no tools'} · {(row.ms / 1000).toFixed(1)}s · {row.tokens.toLocaleString('en-CA')} tok
                      </Text>
                    </View>
                    <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={16} color={MUTED} />
                  </Pressable>
                  {expanded ? (
                    <View style={styles.rowBody}>
                      {row.error ? <Text style={[styles.check, { color: STATUS_COLORS.error }]}>Error: {row.error}</Text> : null}
                      {row.checks.map((check, index) => (
                        <Text key={index} style={styles.check}>
                          <Text style={{ color: check.pass === null ? STATUS_COLORS.review : check.pass ? STATUS_COLORS.pass : STATUS_COLORS.fail }}>
                            {check.pass === null ? '◐' : check.pass ? '✓' : '✗'}
                          </Text>{' '}
                          {check.label}
                          {check.detail ? <Text style={styles.detail}> — {check.detail}</Text> : null}
                        </Text>
                      ))}
                      {row.charts.length ? <Text style={styles.detail}>Charts: {row.charts.join(', ')}</Text> : null}
                      <Text style={styles.answer}>{row.text}</Text>
                    </View>
                  ) : null}
                </View>
              );
            })}
            {!results.length && !running ? <Text style={styles.empty}>Pick a group and press Run.</Text> : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.35)' },
  card: {
    width: '100%',
    maxWidth: 760,
    maxHeight: '90%',
    backgroundColor: '#fcfcfb',
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#d0d0d0',
  },
  head: { flexDirection: 'row', alignItems: 'flex-start', padding: 16, paddingBottom: 8 },
  title: { fontSize: 17, fontWeight: '600', color: INK },
  subtitle: { fontSize: 12, color: MUTED, marginTop: 2 },
  iconButton: { padding: 6, borderRadius: 8 },
  chips: { flexGrow: 0 },
  chipsContent: { paddingHorizontal: 16, gap: 6, paddingBottom: 8 },
  chip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6, borderWidth: StyleSheet.hairlineWidth, borderColor: '#d0d0d0' },
  chipOn: { backgroundColor: INK, borderColor: INK },
  chipText: { fontSize: 12, color: INK },
  chipTextOn: { color: '#fff' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingBottom: 8 },
  run: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: INK, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8 },
  runStop: { backgroundColor: '#c62828' },
  runText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  hint: { flex: 1, fontSize: 11, color: MUTED },
  list: { flexGrow: 0 },
  listContent: { paddingHorizontal: 16, paddingBottom: 16 },
  row: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(42,38,30,0.08)', paddingVertical: 10 },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  rowTitle: { fontSize: 13, color: INK },
  rowMeta: { fontSize: 11, color: MUTED, marginTop: 2 },
  rowBody: { paddingLeft: 20, paddingTop: 8, gap: 4 },
  check: { fontSize: 12, color: INK },
  detail: { fontSize: 12, color: MUTED },
  answer: { fontSize: 12, color: '#3a3a3c', marginTop: 6, lineHeight: 17 },
  empty: { fontSize: 13, color: MUTED, paddingVertical: 24, textAlign: 'center' },
});
