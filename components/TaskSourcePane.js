import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { draftFromMail, listGmailAccounts } from '../lib/gmail';
import { sendDmMessage } from '../lib/messages';
import { CANVAS, MOBILE, NAV_TAB_ACTIVE_RADIUS } from '../lib/mobileUi';
import {
  callbackNumberForTask,
  formatDaysAgo,
  formatTaskWhen,
  loadTaskSource,
  taskChannelLabel,
  taskConversationId,
} from '../lib/tasks';
import EmailComposer from './EmailComposer';
import { usePhoneCalls } from './PhoneCallProvider';

const fontFamily = Platform.select({ ios: 'Sohne', android: 'Sohne', default: 'Sohne' });
const TEXT = MOBILE.label;
const SECONDARY = MOBILE.secondary;
const ACCENT = '#059669';
const HAIRLINE = '#e5e5ea';
const TAB_BORDER = '#d0d0d0';

function digitsIn(value) {
  return String(value || '').replace(/\D/g, '');
}

function Action({ icon, label, onPress, disabled, primary }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ hovered, pressed }) => [
        styles.action,
        primary && styles.actionPrimary,
        (hovered || pressed) && !disabled && !primary && styles.actionHover,
        (hovered || pressed) && !disabled && primary && styles.actionPrimaryHover,
        disabled && styles.actionDisabled,
      ]}
    >
      {disabled && primary ? (
        <ActivityIndicator size="small" color="#fff" />
      ) : (
        <Ionicons name={icon} size={15} color={primary ? '#fff' : ACCENT} />
      )}
      <Text style={[styles.actionText, primary && styles.actionTextPrimary]}>{label}</Text>
    </Pressable>
  );
}

export default function TaskSourcePane({ task, session, isMobile, onClose }) {
  const myId = session?.supabaseUserId || session?.profile?.id || '';
  const phone = usePhoneCalls();
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [compose, setCompose] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [calling, setCalling] = useState(false);
  const [sentNote, setSentNote] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    setDetail(null);
    setCompose(null);
    setReply('');
    setSentNote('');
    (async () => {
      try {
        const next = await loadTaskSource(task, session);
        if (cancelled) return;
        setDetail(next);
        if (next.channel === 'email') {
          const listed = await listGmailAccounts().catch(() => []);
          if (!cancelled) setAccounts(listed.filter((account) => account.connected));
        }
      } catch (err) {
        if (!cancelled) setError(err?.message || 'Could not open that source.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [task, session]);

  const ownEmails = useMemo(() => accounts.map((account) => account.email), [accounts]);
  const conversationId = detail?.conversationId || taskConversationId(task);
  const call = detail?.call || task?.phone || null;
  const callbackNumber = callbackNumberForTask({ phone: call });
  const canCall = digitsIn(callbackNumber).length >= 3;
  const inbound = String(call?.direction || '') !== 'Outbound';
  const otherName = inbound
    ? call?.fromName || call?.from || task?.requester
    : call?.toName || call?.to || task?.requester;
  const otherNumber = inbound ? call?.from : call?.to;
  const channelTitle =
    task?.channel === 'messages' ? detail?.title || task.account || 'Message' : taskChannelLabel(task?.channel);

  const startMailReply = (mode) => {
    if (!detail?.mail) return;
    setCompose(draftFromMail(detail.mail, mode, ownEmails));
  };

  const sendChat = useCallback(async () => {
    const text = reply.trim();
    if (!text || !conversationId) return;
    setSending(true);
    setError('');
    try {
      await sendDmMessage(conversationId, text);
      setReply('');
      setSentNote('Sent.');
      const next = await loadTaskSource(task, session);
      setDetail(next);
    } catch (err) {
      setError(err?.message || 'Could not send that message.');
    } finally {
      setSending(false);
    }
  }, [conversationId, reply, session, task]);

  const callBack = useCallback(async () => {
    if (!canCall) {
      setError('That call has no number to return.');
      return;
    }
    if (!phone.stores?.length) {
      setError('Connect a store in Settings → RingCentral first.');
      return;
    }
    setCalling(true);
    setError('');
    try {
      await phone.dial(callbackNumber, { storeKey: call?.storeKey || call?.store });
      setSentNote(inbound ? 'Calling back…' : 'Calling again…');
    } catch (err) {
      setError(err?.message || 'Could not start the call.');
    } finally {
      setCalling(false);
    }
  }, [call, callbackNumber, canCall, inbound, phone]);

  const header = (
    <View style={styles.head}>
      <View style={styles.headCopy}>
        <Text style={styles.kicker}>{taskChannelLabel(task?.channel)}</Text>
        <Text style={styles.title} numberOfLines={2}>
          {task?.channel === 'email' ? detail?.mail?.subject || task?.subject || task?.title : channelTitle}
        </Text>
        {task?.requester ? (
          <Text style={styles.sub} numberOfLines={1}>
            {task.requester}
            {task.receivedAt ? ` · ${formatTaskWhen(task.receivedAt)}` : ''}
          </Text>
        ) : null}
      </View>
      <Pressable onPress={onClose} hitSlop={8} accessibilityLabel="Close source" style={styles.close}>
        <Ionicons name="close" size={22} color={TEXT} />
      </Pressable>
    </View>
  );

  const body = (() => {
    if (loading) {
      return (
        <View style={styles.centered}>
          <ActivityIndicator color={SECONDARY} />
          <Text style={styles.muted}>Loading…</Text>
        </View>
      );
    }
    if (compose && detail?.mail) {
      return (
        <View style={styles.composeHost}>
          <EmailComposer
            key={`${compose.mode}:${detail.mail.id}`}
            draft={compose}
            accounts={accounts}
            initialAccount={detail.mail.account || task.account}
            contacts={[]}
            isMobile={isMobile}
            onClose={() => setCompose(null)}
            onSent={() => {
              setCompose(null);
              setSentNote('Reply sent.');
            }}
          />
        </View>
      );
    }
    if (detail?.channel === 'email' && detail.mail) {
      const mail = detail.mail;
      const from = mail.sender?.fullName || mail.sender?.email || '';
      const to = (mail.recipients || [])
        .map((person) => person.fullName || person.email)
        .filter(Boolean)
        .join(', ');
      return (
        <>
          <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
            <Text style={styles.metaLabel}>From</Text>
            <Text style={styles.metaValue}>{from || '—'}</Text>
            {to ? (
              <>
                <Text style={styles.metaLabel}>To</Text>
                <Text style={styles.metaValue}>{to}</Text>
              </>
            ) : null}
            {mail.account ? (
              <>
                <Text style={styles.metaLabel}>Inbox</Text>
                <Text style={styles.metaValue}>{mail.account}</Text>
              </>
            ) : null}
            <View style={styles.bodyCard}>
              <Text style={styles.bodyText}>{mail.body || mail.preview || task.detail || 'No message body.'}</Text>
            </View>
          </ScrollView>
          <View style={styles.actions}>
            <Action icon="arrow-undo-outline" label="Reply" primary onPress={() => startMailReply('reply')} />
            <Action icon="arrow-undo-circle-outline" label="Reply all" onPress={() => startMailReply('replyAll')} />
          </View>
        </>
      );
    }
    if (detail?.channel === 'messages') {
      const rows = detail.messages || [];
      return (
        <>
          <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
            {rows.length ? (
              rows.map((message) => {
                const mine = message.senderId === myId;
                const focus = message.id === task.messageId;
                return (
                  <View key={message.id} style={[styles.bubbleRow, mine && styles.bubbleRowMine]}>
                    <View style={[styles.bubble, mine && styles.bubbleMine, focus && styles.bubbleFocus]}>
                      {!mine ? (
                        <Text style={styles.bubbleFrom} numberOfLines={1}>
                          {message.fromName || 'Teammate'}
                        </Text>
                      ) : null}
                      <Text style={[styles.bubbleText, mine && styles.bubbleTextMine]}>{message.body}</Text>
                      <Text style={[styles.bubbleWhen, mine && styles.bubbleWhenMine]}>
                        {formatTaskWhen(message.createdAt)}
                      </Text>
                    </View>
                  </View>
                );
              })
            ) : (
              <Text style={styles.muted}>{task.detail || 'No messages in this thread.'}</Text>
            )}
          </ScrollView>
          <View style={styles.composer}>
            <TextInput
              style={styles.input}
              value={reply}
              onChangeText={setReply}
              placeholder="Reply…"
              placeholderTextColor={SECONDARY}
              multiline
              accessibilityLabel="Reply to this conversation"
            />
            <Pressable
              onPress={sendChat}
              disabled={sending || !reply.trim()}
              accessibilityRole="button"
              accessibilityLabel="Send reply"
              style={({ hovered, pressed }) => [
                styles.send,
                (hovered || pressed) && reply.trim() && styles.sendHover,
                (!reply.trim() || sending) && styles.sendDisabled,
              ]}
            >
              {sending ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Ionicons name="send" size={16} color="#fff" />
              )}
            </Pressable>
          </View>
        </>
      );
    }
    if (task?.channel === 'phone') {
      return (
        <>
          <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
            <Text style={styles.metaLabel}>{inbound ? 'From' : 'To'}</Text>
            <Text style={styles.metaValue}>{otherName || 'Unknown'}</Text>
            {otherNumber ? (
              <>
                <Text style={styles.metaLabel}>Number</Text>
                <Text style={styles.metaValue}>{otherNumber}</Text>
              </>
            ) : null}
            <Text style={styles.metaLabel}>Store</Text>
            <Text style={styles.metaValue}>{call?.store || task.account || '—'}</Text>
            <Text style={styles.metaLabel}>{call?.kind === 'voicemail' ? 'Voicemail' : 'Result'}</Text>
            <Text style={styles.metaValue}>{call?.subject || call?.result || task.subject || 'Call'}</Text>
            {task.detail ? (
              <View style={styles.bodyCard}>
                <Text style={styles.bodyText}>{task.detail}</Text>
              </View>
            ) : null}
          </ScrollView>
          <View style={styles.actions}>
            <Action
              icon="call-outline"
              label={inbound ? 'Call back' : 'Call again'}
              primary
              disabled={!canCall || calling}
              onPress={callBack}
            />
          </View>
        </>
      );
    }
    return (
      <View style={styles.centered}>
        <Text style={styles.muted}>{error || task?.detail || 'Nothing to show for this task.'}</Text>
      </View>
    );
  })();

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.pane, isMobile && styles.paneMobile]}
    >
      {header}
      {error && !loading ? <Text style={styles.error}>{error}</Text> : null}
      {sentNote && !error ? <Text style={styles.note}>{sentNote}</Text> : null}
      {body}
      {task?.receivedAt && !compose ? (
        <Text style={styles.daysAgo}>{formatDaysAgo(task.receivedAt)}</Text>
      ) : null}
    </KeyboardAvoidingView>
  );
}

export const TASK_PANE_WIDTH = 440;

const styles = StyleSheet.create({
  pane: {
    width: TASK_PANE_WIDTH,
    maxWidth: '100%',
    flexGrow: 0,
    flexShrink: 0,
    alignSelf: 'stretch',
    backgroundColor: CANVAS,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: 'rgba(42,38,30,0.16)',
    ...Platform.select({
      web: { boxShadow: '-12px 0 28px rgba(0,0,0,0.06)' },
      default: {},
    }),
  },
  paneMobile: {
    width: '100%',
    borderLeftWidth: 0,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(42,38,30,0.12)',
  },
  headCopy: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  kicker: {
    fontFamily,
    fontSize: 11,
    fontWeight: '700',
    color: ACCENT,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  title: {
    fontFamily,
    fontSize: 17,
    fontWeight: '600',
    color: TEXT,
    letterSpacing: -0.2,
  },
  sub: {
    fontFamily,
    fontSize: 13,
    color: SECONDARY,
  },
  close: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({ web: { cursor: 'pointer' }, default: {} }),
  },
  error: {
    fontFamily,
    fontSize: 13,
    color: '#B91C1C',
    paddingHorizontal: 18,
    paddingTop: 10,
  },
  note: {
    fontFamily,
    fontSize: 13,
    color: ACCENT,
    paddingHorizontal: 18,
    paddingTop: 10,
  },
  composeHost: {
    flex: 1,
    minHeight: 0,
  },
  scroll: {
    flex: 1,
    minHeight: 0,
  },
  scrollContent: {
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 20,
    gap: 6,
  },
  metaLabel: {
    fontFamily,
    fontSize: 11,
    fontWeight: '700',
    color: SECONDARY,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginTop: 8,
  },
  metaValue: {
    fontFamily,
    fontSize: 15,
    color: TEXT,
    lineHeight: 20,
  },
  bodyCard: {
    marginTop: 12,
    padding: 14,
    borderRadius: 12,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: TAB_BORDER,
  },
  bodyText: {
    fontFamily,
    fontSize: 15,
    lineHeight: 22,
    color: TEXT,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: HAIRLINE,
  },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 36,
    paddingHorizontal: 12,
    borderRadius: NAV_TAB_ACTIVE_RADIUS,
    borderWidth: 1,
    borderColor: TAB_BORDER,
    backgroundColor: CANVAS,
    ...Platform.select({ web: { cursor: 'pointer' }, default: {} }),
  },
  actionPrimary: {
    backgroundColor: ACCENT,
    borderColor: ACCENT,
  },
  actionHover: {
    backgroundColor: '#f0f0f2',
  },
  actionPrimaryHover: {
    backgroundColor: '#047857',
  },
  actionDisabled: {
    opacity: 0.55,
  },
  actionText: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: TEXT,
  },
  actionTextPrimary: {
    color: '#fff',
  },
  bubbleRow: {
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  bubbleRowMine: {
    alignItems: 'flex-end',
  },
  bubble: {
    maxWidth: '88%',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#e9e9eb',
  },
  bubbleMine: {
    backgroundColor: ACCENT,
  },
  bubbleFocus: {
    borderWidth: 2,
    borderColor: '#34d399',
  },
  bubbleFrom: {
    fontFamily,
    fontSize: 11,
    fontWeight: '600',
    color: SECONDARY,
    marginBottom: 2,
  },
  bubbleText: {
    fontFamily,
    fontSize: 15,
    lineHeight: 20,
    color: TEXT,
  },
  bubbleTextMine: {
    color: '#fff',
  },
  bubbleWhen: {
    fontFamily,
    fontSize: 11,
    color: SECONDARY,
    marginTop: 4,
  },
  bubbleWhenMine: {
    color: 'rgba(255,255,255,0.78)',
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: HAIRLINE,
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 120,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: TAB_BORDER,
    backgroundColor: '#fff',
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontFamily,
    fontSize: 15,
    color: TEXT,
  },
  send: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: ACCENT,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({ web: { cursor: 'pointer' }, default: {} }),
  },
  sendHover: {
    backgroundColor: '#047857',
  },
  sendDisabled: {
    opacity: 0.45,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 8,
  },
  muted: {
    fontFamily,
    fontSize: 14,
    color: SECONDARY,
    textAlign: 'center',
  },
  daysAgo: {
    fontFamily,
    fontSize: 12,
    color: SECONDARY,
    paddingHorizontal: 18,
    paddingTop: 6,
    paddingBottom: 14,
  },
});
