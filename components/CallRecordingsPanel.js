/**
 * Recordings & AI review for one store's calls.
 *
 * Lists the recorded calls in the Phone screen's chosen date window, plays
 * each recording through the proxy (RingCentral's media host), and sends one
 * call or a batch to RingCentral's AI:
 *
 *   - "Analyze": RingCentral AI API (Interaction Analytics) — summary,
 *     sentiment, topics, key phrases, questions, talk/listen ratio and a
 *     speaker-tagged transcript. Asynchronous: the proxy queues the job and
 *     the result arrives on its webhook, so this panel polls while jobs run.
 *   - "RingSense": RingSense for RingEX insights for a call, when the line
 *     has a RingSense licence.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  INSIGHT_LANGUAGES,
  fetchCallInsights,
  fetchRecordingAudioUrl,
  fetchRingSenseInsight,
  formatCallWhen,
  formatDuration,
  hasRecording,
  insightStatusLabel,
  requestCallInsights,
  resultLabel,
  summarizeInsight,
  summarizeInsightBatch,
} from '../lib/phoneCalls';
import { formatPhoneNumber } from '../lib/ringcentral';

const fontFamily = Platform.select({ ios: 'Sohne', android: 'Sohne', default: 'Sohne' });
const ACCENT = '#15803D';
const POLL_MS = 15_000;
const BATCH_MAX = 25;
const TRANSCRIPT_PREVIEW = 40;

function partyLine(row) {
  const inbound = String(row?.direction || '') !== 'Outbound';
  const number = inbound ? row?.from : row?.to;
  const name = inbound ? row?.fromName : row?.toName;
  return [name, number ? formatPhoneNumber(number) : ''].filter(Boolean).join(' · ') || 'Unknown';
}

function clock(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function sentimentTone(value) {
  const key = String(value || '').toLowerCase();
  if (/positive|happy|satisf/.test(key)) return { backgroundColor: '#ECFDF5', color: '#166534' };
  if (/negative|angry|frustrat|sad|upset/.test(key)) return { backgroundColor: '#FEF2F2', color: '#991B1B' };
  if (/mixed/.test(key)) return { backgroundColor: '#FFF7ED', color: '#9A3412' };
  return { backgroundColor: '#F3F4F6', color: '#374151' };
}

function defaultLanguage(storeName) {
  return /montr|laval|qu[ée]bec|gatineau|sherbrooke|trois|longueuil|brossard/i.test(String(storeName || ''))
    ? 'fr-CA'
    : 'en-US';
}

function Chip({ label, tone, small }) {
  const style = tone || { backgroundColor: '#F3F4F6', color: '#374151' };
  return (
    <View style={[styles.chip, { backgroundColor: style.backgroundColor }, small && styles.chipSmall]}>
      <Text style={[styles.chipText, { color: style.color }, small && styles.chipTextSmall]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

function InsightDetails({ insight }) {
  const [showAll, setShowAll] = useState(false);
  const view = useMemo(() => summarizeInsight(insight), [insight]);
  if (!view) return null;
  const transcript = showAll ? view.utterances : view.utterances.slice(0, TRANSCRIPT_PREVIEW);
  return (
    <View style={styles.details}>
      {view.summary ? (
        <View style={styles.block}>
          <Text style={styles.blockLabel}>Summary</Text>
          <Text style={styles.summary}>{view.summary}</Text>
        </View>
      ) : null}
      {view.summaryLong && view.summaryLong !== view.summary ? (
        <View style={styles.block}>
          <Text style={styles.blockLabel}>Detail</Text>
          <Text style={styles.body}>{view.summaryLong}</Text>
        </View>
      ) : null}
      {view.sentiment || view.topics.length ? (
        <View style={styles.chips}>
          {view.sentiment ? <Chip label={`Sentiment: ${view.sentiment}`} tone={sentimentTone(view.sentiment)} /> : null}
          {view.topics.map((topic) => (
            <Chip key={topic} label={topic} />
          ))}
        </View>
      ) : null}
      {view.keyPhrases.length ? (
        <View style={styles.block}>
          <Text style={styles.blockLabel}>Key phrases</Text>
          <Text style={styles.body}>{view.keyPhrases.join(' · ')}</Text>
        </View>
      ) : null}
      {view.questions.length ? (
        <View style={styles.block}>
          <Text style={styles.blockLabel}>Questions asked</Text>
          {view.questions.map((q, index) => (
            <View key={`${q.question}-${index}`} style={styles.qa}>
              <Text style={styles.body}>
                {q.speaker ? <Text style={styles.speaker}>{q.speaker}: </Text> : null}
                {q.question}
              </Text>
              {q.answer ? <Text style={styles.answer}>↳ {q.answer}</Text> : null}
            </View>
          ))}
        </View>
      ) : null}
      {view.talkToListen.length ? (
        <View style={styles.block}>
          <Text style={styles.blockLabel}>Talk / listen</Text>
          <Text style={styles.body}>
            {view.talkToListen
              .map((row) => `${row.speaker || 'Speaker'} ${Math.round(row.value * (row.value <= 1 ? 100 : 1))}%`)
              .join(' · ')}
          </Text>
        </View>
      ) : null}
      {Object.keys(view.emotions).length ? (
        <View style={styles.chips}>
          {Object.entries(view.emotions)
            .sort((a, b) => b[1] - a[1])
            .map(([emotion, count]) => (
              <Chip key={emotion} label={`${emotion} ×${count}`} tone={sentimentTone(emotion)} small />
            ))}
        </View>
      ) : null}
      {view.utterances.length ? (
        <View style={styles.block}>
          <Text style={styles.blockLabel}>Transcript</Text>
          {transcript.map((u, index) => (
            <View key={`${u.start}-${index}`} style={styles.utterance}>
              <Text style={styles.stamp}>{clock(u.start)}</Text>
              <Text style={styles.body}>
                {u.speaker ? <Text style={styles.speaker}>{u.speaker}: </Text> : null}
                {u.text}
                {u.emotion && !/neutral/i.test(u.emotion) ? <Text style={styles.emotion}> ({u.emotion})</Text> : null}
              </Text>
            </View>
          ))}
          {view.utterances.length > TRANSCRIPT_PREVIEW ? (
            <Pressable onPress={() => setShowAll((v) => !v)}>
              <Text style={styles.link}>
                {showAll ? 'Show less' : `Show all ${view.utterances.length} lines`}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function BatchSummary({ insights }) {
  const batch = useMemo(() => summarizeInsightBatch(insights), [insights]);
  if (!batch.analyzed) return null;
  const total = Object.values(batch.sentiments).reduce((sum, n) => sum + n, 0) || 1;
  return (
    <View style={styles.batchCard}>
      <View style={styles.batchHead}>
        <Text style={styles.batchTitle}>Across {batch.analyzed} analyzed call{batch.analyzed === 1 ? '' : 's'}</Text>
        <Text style={styles.meta}>{formatDuration(batch.totalDuration)} of conversation</Text>
      </View>
      {Object.keys(batch.sentiments).length ? (
        <View style={styles.chips}>
          {Object.entries(batch.sentiments)
            .sort((a, b) => b[1] - a[1])
            .map(([sentiment, count]) => (
              <Chip
                key={sentiment}
                label={`${sentiment} ${Math.round((count / total) * 100)}%`}
                tone={sentimentTone(sentiment)}
              />
            ))}
        </View>
      ) : null}
      {batch.topics.length ? (
        <View style={styles.block}>
          <Text style={styles.blockLabel}>Top topics</Text>
          <View style={styles.chips}>
            {batch.topics.map((row) => (
              <Chip key={row.value} label={row.count > 1 ? `${row.value} ×${row.count}` : row.value} small />
            ))}
          </View>
        </View>
      ) : null}
      {batch.keyPhrases.length ? (
        <View style={styles.block}>
          <Text style={styles.blockLabel}>Recurring phrases</Text>
          <Text style={styles.body}>{batch.keyPhrases.map((row) => row.value).join(' · ')}</Text>
        </View>
      ) : null}
    </View>
  );
}

export default function CallRecordingsPanel({ storeKey, storeName, calls, loading, rangeLabel, canManage }) {
  const [insights, setInsights] = useState([]);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [aiError, setAiError] = useState('');
  const [notice, setNotice] = useState('');
  const [busyIds, setBusyIds] = useState(() => new Set());
  const [expanded, setExpanded] = useState('');
  const [language, setLanguage] = useState(() => defaultLanguage(storeName));
  const [playingId, setPlayingId] = useState('');
  const [playLoadingId, setPlayLoadingId] = useState('');
  const [playError, setPlayError] = useState('');
  const audioRef = useRef(null);
  const objectUrlRef = useRef('');
  const requestRef = useRef(0);

  useEffect(() => {
    setLanguage(defaultLanguage(storeName));
  }, [storeName]);

  const recorded = useMemo(() => {
    const rows = (Array.isArray(calls) ? calls : []).filter(hasRecording);
    rows.sort((a, b) => String(b.startTime || '').localeCompare(String(a.startTime || '')));
    return rows;
  }, [calls]);

  const aiByRecording = useMemo(() => {
    const map = new Map();
    for (const row of insights) {
      if (row.source !== 'rc_ai' || !row.recordingId) continue;
      const have = map.get(row.recordingId);
      if (!have || String(row.createdAt) > String(have.createdAt)) map.set(row.recordingId, row);
    }
    return map;
  }, [insights]);
  const ringSenseBySession = useMemo(() => {
    const map = new Map();
    for (const row of insights) {
      if (row.source === 'ringsense' && row.telephonySessionId) map.set(row.telephonySessionId, row);
    }
    return map;
  }, [insights]);

  const loadInsights = useCallback(
    async ({ quiet = false } = {}) => {
      if (!storeKey || !canManage) return;
      const id = ++requestRef.current;
      if (!quiet) setInsightsLoading(true);
      try {
        const payload = await fetchCallInsights(storeKey);
        if (id !== requestRef.current) return;
        setInsights(payload.insights);
        if (payload.aiError) setAiError(payload.aiError);
      } catch (err) {
        if (id !== requestRef.current) return;
        if (!quiet) setAiError(err?.message || 'Could not load analyses.');
      } finally {
        if (id === requestRef.current && !quiet) setInsightsLoading(false);
      }
    },
    [canManage, storeKey],
  );

  useEffect(() => {
    setInsights([]);
    setAiError('');
    setNotice('');
    setExpanded('');
    loadInsights();
  }, [loadInsights]);

  const pendingCount = insights.filter((row) => row.status === 'queued' || row.status === 'processing').length;
  useEffect(() => {
    if (!pendingCount) return undefined;
    const timer = setInterval(() => {
      loadInsights({ quiet: true });
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [loadInsights, pendingCount]);

  useEffect(
    () => () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = '';
      }
    },
    [],
  );

  const play = async (row) => {
    setPlayError('');
    if (playingId === row.recordingId) {
      audioRef.current?.pause();
      setPlayingId('');
      return;
    }
    if (typeof Audio === 'undefined') {
      setPlayError('Recording playback is available in the browser.');
      return;
    }
    setPlayLoadingId(row.recordingId);
    try {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = '';
      }
      const url = await fetchRecordingAudioUrl(row.storeKey || storeKey, row.recordingId);
      objectUrlRef.current = url;
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => setPlayingId('');
      await audio.play();
      setPlayingId(row.recordingId);
    } catch (err) {
      setPlayError(err?.message || 'Could not play that recording.');
      setPlayingId('');
    } finally {
      setPlayLoadingId('');
    }
  };

  const markBusy = (ids, on) => {
    setBusyIds((current) => {
      const next = new Set(current);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  };

  const analyze = async (rows) => {
    const targets = rows.filter(hasRecording).slice(0, BATCH_MAX);
    if (!targets.length) return;
    const ids = targets.map((row) => row.recordingId);
    setAiError('');
    setNotice('');
    markBusy(ids, true);
    try {
      const payload = await requestCallInsights(storeKey, targets, { languageCode: language });
      setInsights((current) => {
        const byId = new Map(current.map((row) => [row.id, row]));
        for (const row of payload.insights) byId.set(row.id, row);
        return [...byId.values()];
      });
      if (payload.aiError) setAiError(payload.aiError);
      const parts = [];
      if (payload.submitted) parts.push(`${payload.submitted} sent to RingCentral AI`);
      if (payload.queued > payload.submitted) parts.push(`${payload.queued - payload.submitted} queued (rate limit)`);
      if (payload.skipped) parts.push(`${payload.skipped} already analyzed`);
      if (parts.length) setNotice(`${parts.join(' · ')}. Results appear here when RingCentral finishes.`);
    } catch (err) {
      setAiError(err?.message || 'Could not start the analysis.');
    } finally {
      markBusy(ids, false);
    }
  };

  const ringSense = async (row) => {
    const key = `rs:${row.telephonySessionId}`;
    setAiError('');
    markBusy([key], true);
    try {
      const payload = await fetchRingSenseInsight(storeKey, row);
      if (payload.insight) {
        setInsights((current) => {
          const others = current.filter((item) => item.id !== payload.insight.id);
          return [payload.insight, ...others];
        });
        if (payload.insight.status === 'done') setExpanded(payload.insight.id);
      }
      if (payload.aiError) setAiError(payload.aiError);
    } catch (err) {
      setAiError(err?.message || 'Could not load RingSense insights.');
    } finally {
      markBusy([key], false);
    }
  };

  if (!canManage) {
    return (
      <View style={styles.section}>
        <Text style={styles.empty}>
          Recorded conversations and AI reviews are available to branch managers and above.
        </Text>
      </View>
    );
  }

  const analyzable = recorded.filter((row) => {
    const have = aiByRecording.get(row.recordingId);
    return !have || have.status === 'failed';
  });
  const anyBusy = busyIds.size > 0;
  const doneInsights = insights.filter((row) => row.status === 'done');

  return (
    <View style={styles.section}>
      <View style={styles.toolbar}>
        <View style={styles.toolbarCopy}>
          <Text style={styles.title}>
            {recorded.length} recorded call{recorded.length === 1 ? '' : 's'} {rangeLabel}
          </Text>
          <Text style={styles.meta}>
            RingCentral records these lines automatically. Play a call here, or send it to RingCentral’s AI for a
            summary, sentiment, topics and a transcript.
          </Text>
        </View>
        <View style={styles.toolbarActions}>
          <View style={styles.langGroup}>
            {INSIGHT_LANGUAGES.map((item) => {
              const active = language === item.key;
              return (
                <Pressable
                  key={item.key}
                  style={[styles.langChip, active && styles.langChipActive]}
                  onPress={() => setLanguage(item.key)}
                  accessibilityLabel={`Analyze in ${item.label}`}
                >
                  <Text style={[styles.langText, active && styles.langTextActive]}>{item.label}</Text>
                </Pressable>
              );
            })}
          </View>
          <Pressable
            style={[styles.primaryBtn, (!analyzable.length || anyBusy) && styles.btnDisabled]}
            disabled={!analyzable.length || anyBusy}
            onPress={() => analyze(analyzable)}
            accessibilityLabel="Analyze all shown recordings"
          >
            {anyBusy ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <>
                <Ionicons name="sparkles" size={13} color="#fff" />
                <Text style={styles.primaryBtnText}>
                  {analyzable.length ? `Analyze ${Math.min(analyzable.length, BATCH_MAX)} call${analyzable.length === 1 ? '' : 's'}` : 'All analyzed'}
                </Text>
              </>
            )}
          </Pressable>
          <Pressable style={styles.iconBtn} onPress={() => loadInsights()} accessibilityLabel="Refresh analyses">
            {insightsLoading ? <ActivityIndicator size="small" color={ACCENT} /> : <Ionicons name="refresh" size={15} color="#6b6b6b" />}
          </Pressable>
        </View>
      </View>

      {aiError ? (
        <View style={styles.errorBanner}>
          <Ionicons name="alert-circle" size={14} color="#991B1B" />
          <Text style={styles.errorText}>{aiError}</Text>
        </View>
      ) : null}
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
      {pendingCount ? (
        <Text style={styles.notice}>
          {pendingCount} analysis{pendingCount === 1 ? '' : 'es'} in progress — checking every {POLL_MS / 1000}s.
        </Text>
      ) : null}
      {playError ? <Text style={styles.errorText}>{playError}</Text> : null}

      <BatchSummary insights={doneInsights} />

      {loading && recorded.length === 0 ? (
        <View style={styles.centered}>
          <ActivityIndicator color={ACCENT} />
        </View>
      ) : recorded.length === 0 ? (
        <Text style={styles.empty}>
          No recorded calls {rangeLabel}. Recordings appear a minute or two after a recorded call ends; RingCentral
          keeps them for a limited time.
        </Text>
      ) : (
        recorded.map((row) => {
          const ai = aiByRecording.get(row.recordingId) || null;
          const rs = row.telephonySessionId ? ringSenseBySession.get(row.telephonySessionId) || null : null;
          const shown = expanded === ai?.id ? ai : expanded === rs?.id ? rs : null;
          const inbound = row.direction !== 'Outbound';
          const busy = busyIds.has(row.recordingId);
          const rsBusy = busyIds.has(`rs:${row.telephonySessionId}`);
          const status = ai ? insightStatusLabel(ai) : '';
          const view = ai?.status === 'done' ? summarizeInsight(ai) : null;
          return (
            <View key={row.recordingId} style={styles.card}>
              <View style={styles.row}>
                <Pressable
                  style={styles.playBtn}
                  onPress={() => play(row)}
                  accessibilityLabel={playingId === row.recordingId ? 'Pause recording' : 'Play recording'}
                >
                  {playLoadingId === row.recordingId ? (
                    <ActivityIndicator size="small" color={ACCENT} />
                  ) : (
                    <Ionicons name={playingId === row.recordingId ? 'pause' : 'play'} size={16} color={ACCENT} />
                  )}
                </Pressable>
                <View style={styles.rowText}>
                  <Text style={styles.rowTitle} numberOfLines={1}>
                    {partyLine(row)}
                  </Text>
                  <Text style={styles.meta}>
                    {[
                      inbound ? 'Inbound' : 'Outbound',
                      resultLabel(row.result),
                      formatCallWhen(row.startTime),
                      row.duration ? formatDuration(row.duration) : '',
                      row.recordingType === 'OnDemand' ? 'On-demand recording' : '',
                      status,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </Text>
                  {view?.summary ? (
                    <Pressable onPress={() => setExpanded(expanded === ai.id ? '' : ai.id)}>
                      <Text style={styles.preview} numberOfLines={expanded === ai.id ? undefined : 2}>
                        {view.summary}
                      </Text>
                    </Pressable>
                  ) : null}
                  {ai?.status === 'failed' && ai.error ? (
                    <Text style={styles.rowError} numberOfLines={3}>
                      {ai.error}
                    </Text>
                  ) : null}
                </View>
                <View style={styles.actions}>
                  {view?.sentiment ? <Chip label={view.sentiment} tone={sentimentTone(view.sentiment)} small /> : null}
                  {ai?.status === 'done' ? (
                    <Pressable
                      style={styles.secondaryBtn}
                      onPress={() => setExpanded(expanded === ai.id ? '' : ai.id)}
                      accessibilityLabel={expanded === ai.id ? 'Hide analysis' : 'Show analysis'}
                    >
                      <Ionicons name={expanded === ai.id ? 'chevron-up' : 'chevron-down'} size={14} color="#1a1a1a" />
                      <Text style={styles.secondaryBtnText}>{expanded === ai.id ? 'Hide' : 'Details'}</Text>
                    </Pressable>
                  ) : ai?.status === 'processing' || ai?.status === 'queued' ? (
                    <View style={styles.secondaryBtn}>
                      <ActivityIndicator size="small" color={ACCENT} />
                      <Text style={styles.secondaryBtnText}>{insightStatusLabel(ai)}</Text>
                    </View>
                  ) : (
                    <Pressable
                      style={[styles.secondaryBtn, busy && styles.btnDisabled]}
                      disabled={busy}
                      onPress={() => analyze([row])}
                      accessibilityLabel="Analyze this call with RingCentral AI"
                    >
                      {busy ? (
                        <ActivityIndicator size="small" color={ACCENT} />
                      ) : (
                        <>
                          <Ionicons name="sparkles-outline" size={13} color="#1a1a1a" />
                          <Text style={styles.secondaryBtnText}>{ai?.status === 'failed' ? 'Retry' : 'Analyze'}</Text>
                        </>
                      )}
                    </Pressable>
                  )}
                  {row.telephonySessionId ? (
                    <Pressable
                      style={[styles.ghostBtn, rsBusy && styles.btnDisabled]}
                      disabled={rsBusy}
                      onPress={() => (rs?.status === 'done' ? setExpanded(expanded === rs.id ? '' : rs.id) : ringSense(row))}
                      accessibilityLabel="RingSense insights"
                    >
                      {rsBusy ? (
                        <ActivityIndicator size="small" color="#6b6b6b" />
                      ) : (
                        <Text style={styles.ghostBtnText}>RingSense</Text>
                      )}
                    </Pressable>
                  ) : null}
                </View>
              </View>
              {shown ? (
                <>
                  {shown.source === 'ringsense' ? <Text style={styles.sourceTag}>RingSense for RingEX</Text> : null}
                  <InsightDetails insight={shown} />
                </>
              ) : null}
            </View>
          );
        })
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: 8,
  },
  toolbar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
    paddingTop: 4,
  },
  toolbarCopy: {
    flex: 1,
    minWidth: 220,
    gap: 2,
  },
  toolbarActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
  },
  title: {
    fontFamily,
    fontSize: 14,
    fontWeight: '700',
    color: '#1a1a1a',
  },
  meta: {
    fontFamily,
    fontSize: 12,
    color: '#8a8a8a',
    lineHeight: 17,
  },
  langGroup: {
    flexDirection: 'row',
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#d4d4d4',
    overflow: 'hidden',
  },
  langChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: '#fff',
    ...Platform.select({ web: { cursor: 'pointer' }, default: {} }),
  },
  langChipActive: {
    backgroundColor: '#ECFDF5',
  },
  langText: {
    fontFamily,
    fontSize: 12,
    fontWeight: '600',
    color: '#6b6b6b',
  },
  langTextActive: {
    color: ACCENT,
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 30,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: ACCENT,
    ...Platform.select({ web: { cursor: 'pointer' }, default: {} }),
  },
  primaryBtnText: {
    fontFamily,
    fontSize: 12,
    fontWeight: '700',
    color: '#fff',
  },
  btnDisabled: {
    opacity: 0.55,
  },
  iconBtn: {
    width: 30,
    height: 30,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#d4d4d4',
    backgroundColor: '#fff',
    ...Platform.select({ web: { cursor: 'pointer' }, default: {} }),
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    padding: 10,
    borderRadius: 8,
    backgroundColor: '#FEF2F2',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#FECACA',
  },
  errorText: {
    flex: 1,
    fontFamily,
    fontSize: 12,
    lineHeight: 17,
    color: '#991B1B',
  },
  notice: {
    fontFamily,
    fontSize: 12,
    color: '#166534',
  },
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 24,
  },
  empty: {
    fontFamily,
    fontSize: 13,
    color: '#8a8a8a',
    paddingTop: 16,
    paddingBottom: 8,
    lineHeight: 18,
  },
  batchCard: {
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#D5EBD9',
    backgroundColor: '#F3FBF6',
    padding: 12,
    gap: 8,
  },
  batchHead: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: 8,
  },
  batchTitle: {
    fontFamily,
    fontSize: 13,
    fontWeight: '700',
    color: '#1a1a1a',
  },
  card: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f0f0f0',
    paddingVertical: 8,
    gap: 6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  rowTitle: {
    fontFamily,
    fontSize: 14,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  rowError: {
    fontFamily,
    fontSize: 12,
    color: '#991B1B',
    lineHeight: 16,
  },
  preview: {
    fontFamily,
    fontSize: 13,
    color: '#374151',
    lineHeight: 18,
    marginTop: 2,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 6,
    maxWidth: 260,
  },
  playBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#ECFDF5',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
    ...Platform.select({ web: { cursor: 'pointer' }, default: {} }),
  },
  secondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: 28,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#d4d4d4',
    backgroundColor: '#fff',
    ...Platform.select({ web: { cursor: 'pointer' }, default: {} }),
  },
  secondaryBtnText: {
    fontFamily,
    fontSize: 12,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  ghostBtn: {
    minHeight: 28,
    paddingHorizontal: 8,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({ web: { cursor: 'pointer' }, default: {} }),
  },
  ghostBtnText: {
    fontFamily,
    fontSize: 12,
    fontWeight: '600',
    color: '#6b6b6b',
  },
  sourceTag: {
    fontFamily,
    fontSize: 11,
    fontWeight: '700',
    color: '#6b6b6b',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginLeft: 42,
  },
  details: {
    marginLeft: 42,
    gap: 10,
    paddingBottom: 4,
  },
  block: {
    gap: 4,
  },
  blockLabel: {
    fontFamily,
    fontSize: 11,
    fontWeight: '600',
    color: '#8a8a8a',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  summary: {
    fontFamily,
    fontSize: 14,
    fontWeight: '600',
    color: '#1a1a1a',
    lineHeight: 20,
  },
  body: {
    fontFamily,
    fontSize: 13,
    color: '#374151',
    lineHeight: 19,
  },
  speaker: {
    fontWeight: '700',
    color: '#1a1a1a',
  },
  emotion: {
    color: '#9A3412',
    fontStyle: 'italic',
  },
  answer: {
    fontFamily,
    fontSize: 13,
    color: '#6b6b6b',
    lineHeight: 19,
    marginLeft: 12,
  },
  qa: {
    gap: 2,
  },
  utterance: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
  },
  stamp: {
    fontFamily,
    fontSize: 11,
    color: '#8a8a8a',
    width: 36,
    paddingTop: 2,
    fontVariant: ['tabular-nums'],
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    maxWidth: 260,
  },
  chipSmall: {
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  chipText: {
    fontFamily,
    fontSize: 12,
    fontWeight: '600',
  },
  chipTextSmall: {
    fontSize: 11,
  },
  link: {
    fontFamily,
    fontSize: 12,
    fontWeight: '600',
    color: ACCENT,
    paddingTop: 4,
  },
});
