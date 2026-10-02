import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  canReviewDevTickets,
  createDevTicket,
  decideDevTicket,
  DEV_TICKET_STATUSES,
  launchDevTicket,
  listDevTickets,
  refreshDevTicket,
  subscribeDevTickets,
} from '../lib/devTickets';

const BLUE = '#0A84FF';
const OPEN_STATUSES = new Set(['submitted', 'launching', 'in_progress']);

function statusColor(status) {
  if (status === 'ready') return '#0B7A3B';
  if (status === 'failed' || status === 'rejected') return '#C0392B';
  if (status === 'approved') return '#1D4ED8';
  return '#8A6A12';
}

function openUrl(url) {
  const href = String(url || '').trim();
  if (!href) return;
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    window.open(href, '_blank', 'noopener,noreferrer');
    return;
  }
  void Linking.openURL(href);
}

export default function DevTicketsPanel({ profile, onClose }) {
  const canReview = canReviewDevTickets(profile);
  const [draft, setDraft] = useState('');
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const rows = await listDevTickets();
      setTickets(rows);
      setError('');
    } catch (err) {
      setError(err.message || 'Could not load tickets.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    return subscribeDevTickets(() => {
      void load();
    });
  }, [load]);

  useEffect(() => {
    const open = tickets.filter((row) => OPEN_STATUSES.has(row.status) && row.id);
    if (open.length === 0) return undefined;
    const timer = setInterval(() => {
      open.forEach((row) => {
        void refreshDevTicket(row.id).catch(() => null);
      });
    }, 8000);
    return () => clearInterval(timer);
  }, [tickets]);

  const submit = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setError('');
    try {
      const created = await createDevTicket(text);
      setDraft('');
      setTickets((current) => [created, ...current.filter((row) => row.id !== created.id)]);
      await launchDevTicket(created.id);
      await load();
    } catch (err) {
      setError(err.message || 'Could not send that ticket.');
    } finally {
      setSending(false);
    }
  };

  const decide = async (ticket, action) => {
    setBusyId(ticket.id);
    setError('');
    try {
      await decideDevTicket(ticket.id, action);
      await load();
    } catch (err) {
      setError(err.message || 'Could not update that ticket.');
    } finally {
      setBusyId('');
    }
  };

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.heading}>New ticket</Text>
        <Pressable onPress={onClose} hitSlop={8} accessibilityLabel="Close tickets">
          <Ionicons name="close" size={18} color="#1d1d1f" />
        </Pressable>
      </View>
      <Text style={styles.hint}>
        Describe what you want fixed. A cloud agent opens a branch and pull request. Preview it on Vercel before it is approved.
      </Text>
      <TextInput
        style={styles.input}
        value={draft}
        onChangeText={setDraft}
        placeholder="What needs to be fixed?"
        placeholderTextColor="#8e8e93"
        multiline
        maxLength={8000}
      />
      <Pressable
        onPress={() => void submit()}
        disabled={!draft.trim() || sending}
        style={({ pressed }) => [
          styles.send,
          (!draft.trim() || sending) && styles.sendOff,
          pressed && draft.trim() && styles.sendPressed,
        ]}
        accessibilityLabel="Send ticket"
      >
        {sending ? (
          <ActivityIndicator color="#fff" size="small" />
        ) : (
          <>
            <Text style={styles.sendText}>Send ticket</Text>
            <Ionicons name="arrow-forward" size={14} color="#fff" />
          </>
        )}
      </Pressable>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Text style={styles.listHeading}>Tickets</Text>
      {loading ? (
        <ActivityIndicator color={BLUE} style={{ marginTop: 16 }} />
      ) : (
        <ScrollView style={styles.list} contentContainerStyle={styles.listContent} keyboardShouldPersistTaps="handled">
          {tickets.length === 0 ? (
            <Text style={styles.empty}>No tickets yet.</Text>
          ) : (
            tickets.map((ticket) => (
              <View key={ticket.id} style={styles.card}>
                <View style={styles.cardTop}>
                  <Text style={styles.cardTitle} numberOfLines={2}>
                    {ticket.title || ticket.body}
                  </Text>
                  <Text style={[styles.badge, { color: statusColor(ticket.status) }]}>
                    {DEV_TICKET_STATUSES[ticket.status] || ticket.status}
                  </Text>
                </View>
                <Text style={styles.cardBody} numberOfLines={4}>
                  {ticket.body}
                </Text>
                {ticket.error ? <Text style={styles.cardError}>{ticket.error}</Text> : null}
                {ticket.agentSummary ? (
                  <Text style={styles.summary} numberOfLines={5}>
                    {ticket.agentSummary}
                  </Text>
                ) : null}
                <View style={styles.links}>
                  {ticket.previewUrl ? (
                    <Pressable onPress={() => openUrl(ticket.previewUrl)} style={styles.link}>
                      <Ionicons name="eye-outline" size={14} color={BLUE} />
                      <Text style={styles.linkText}>Preview</Text>
                    </Pressable>
                  ) : null}
                  {ticket.prUrl ? (
                    <Pressable onPress={() => openUrl(ticket.prUrl)} style={styles.link}>
                      <Ionicons name="git-pull-request-outline" size={14} color={BLUE} />
                      <Text style={styles.linkText}>Pull request</Text>
                    </Pressable>
                  ) : null}
                  {ticket.agentUrl ? (
                    <Pressable onPress={() => openUrl(ticket.agentUrl)} style={styles.link}>
                      <Ionicons name="hardware-chip-outline" size={14} color={BLUE} />
                      <Text style={styles.linkText}>Agent</Text>
                    </Pressable>
                  ) : null}
                  {ticket.branch ? <Text style={styles.branch}>{ticket.branch}</Text> : null}
                </View>
                {canReview && ticket.status === 'ready' ? (
                  <View style={styles.actions}>
                    <Pressable
                      onPress={() => void decide(ticket, 'reject')}
                      disabled={busyId === ticket.id}
                      style={({ pressed }) => [styles.reject, pressed && styles.rejectPressed]}
                    >
                      <Text style={styles.rejectText}>Reject</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => void decide(ticket, 'approve')}
                      disabled={busyId === ticket.id}
                      style={({ pressed }) => [styles.approve, pressed && styles.approvePressed]}
                    >
                      {busyId === ticket.id ? (
                        <ActivityIndicator color="#fff" size="small" />
                      ) : (
                        <Text style={styles.approveText}>Approve & merge</Text>
                      )}
                    </Pressable>
                  </View>
                ) : null}
              </View>
            ))
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    minHeight: 0,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  heading: {
    fontSize: 17,
    fontWeight: '700',
    color: '#1d1d1f',
  },
  hint: {
    fontSize: 13,
    lineHeight: 18,
    color: '#6e6e73',
    marginBottom: 10,
  },
  input: {
    minHeight: 88,
    maxHeight: 140,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#fff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0,0,0,0.1)',
    fontSize: 15,
    color: '#1a1a1a',
    textAlignVertical: 'top',
    outlineStyle: 'none',
  },
  send: {
    marginTop: 10,
    alignSelf: 'flex-end',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: BLUE,
    borderRadius: 16,
    paddingHorizontal: 14,
    height: 32,
    ...Platform.select({ web: { cursor: 'pointer' }, default: {} }),
  },
  sendOff: {
    opacity: 0.45,
  },
  sendPressed: {
    opacity: 0.85,
  },
  sendText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#fff',
  },
  error: {
    marginTop: 8,
    fontSize: 13,
    color: '#C0392B',
  },
  listHeading: {
    marginTop: 18,
    marginBottom: 8,
    fontSize: 13,
    fontWeight: '600',
    color: '#8e8e93',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  list: {
    flex: 1,
    minHeight: 0,
  },
  listContent: {
    paddingBottom: 24,
    gap: 10,
  },
  empty: {
    fontSize: 14,
    color: '#8e8e93',
  },
  card: {
    borderRadius: 14,
    padding: 12,
    backgroundColor: 'rgba(255,255,255,0.72)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0,0,0,0.08)',
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
  },
  cardTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: '#1d1d1f',
  },
  badge: {
    fontSize: 11,
    fontWeight: '700',
  },
  cardBody: {
    marginTop: 6,
    fontSize: 13,
    lineHeight: 18,
    color: '#3a3a3c',
  },
  cardError: {
    marginTop: 6,
    fontSize: 12,
    color: '#C0392B',
  },
  summary: {
    marginTop: 8,
    fontSize: 12,
    lineHeight: 17,
    color: '#6e6e73',
  },
  links: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 10,
    marginTop: 10,
  },
  link: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    ...Platform.select({ web: { cursor: 'pointer' }, default: {} }),
  },
  linkText: {
    fontSize: 13,
    fontWeight: '600',
    color: BLUE,
  },
  branch: {
    fontSize: 11,
    color: '#8e8e93',
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 12,
  },
  reject: {
    height: 30,
    paddingHorizontal: 12,
    borderRadius: 15,
    justifyContent: 'center',
    backgroundColor: '#f2f2f7',
    ...Platform.select({ web: { cursor: 'pointer' }, default: {} }),
  },
  rejectPressed: {
    opacity: 0.8,
  },
  rejectText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1d1d1f',
  },
  approve: {
    height: 30,
    paddingHorizontal: 12,
    borderRadius: 15,
    justifyContent: 'center',
    backgroundColor: '#0B7A3B',
    minWidth: 128,
    alignItems: 'center',
    ...Platform.select({ web: { cursor: 'pointer' }, default: {} }),
  },
  approvePressed: {
    opacity: 0.85,
  },
  approveText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#fff',
  },
});
