import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { avatarColorForId, contactName, initialsFromName } from '../lib/messages';
import {
  getGmailSignature,
  isEmailAddress,
  isGmailNotConnected,
  isGmailSendScopeMissing,
  sendGmailMessage,
} from '../lib/gmail';

const fontFamily = Platform.select({ ios: 'Sohne', android: 'Sohne', default: 'Sohne' });
const ACCENT = '#4338CA';
const INK = '#1d1d1f';
const SECONDARY = '#8e8e93';
const HAIRLINE = '#e5e5ea';
const FIELD_BG = '#f5f5f7';

const MODE_TITLES = {
  new: 'New message',
  reply: 'Reply',
  replyAll: 'Reply all',
  forward: 'Forward',
};

function asString(value) {
  return value == null ? '' : String(value).trim();
}

function personFor(entry) {
  const email = asString(entry?.email).toLowerCase();
  const name = asString(entry?.name || entry?.fullName) || email;
  return { id: entry?.id || email, email, fullName: name, name, avatarUrl: asString(entry?.avatarUrl) };
}

function MiniAvatar({ person, size = 22 }) {
  const [failed, setFailed] = useState(false);
  const name = contactName(person);
  const uri = person?.avatarUrl;
  const showImage = Boolean(uri) && !failed;
  useEffect(() => setFailed(false), [uri]);
  return (
    <View
      style={[
        styles.avatar,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: showImage ? '#e8e8ed' : avatarColorForId(person?.id || person?.email || name),
        },
      ]}
    >
      {showImage ? (
        <Image source={{ uri }} style={{ width: size, height: size }} onError={() => setFailed(true)} />
      ) : (
        <Text style={[styles.avatarInitials, { fontSize: Math.max(9, Math.round(size * 0.4)) }]}>
          {initialsFromName(name) || '?'}
        </Text>
      )}
    </View>
  );
}

function RecipientChip({ person, onRemove }) {
  const label = person.fullName && person.fullName !== person.email ? person.fullName : person.email;
  return (
    <View style={styles.chip} accessibilityLabel={`${label} ${person.email}`}>
      <MiniAvatar person={person} size={20} />
      <Text style={styles.chipText} numberOfLines={1}>
        {label}
      </Text>
      <Pressable
        onPress={onRemove}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel={`Remove ${label}`}
        style={({ hovered, pressed }) => [styles.chipRemove, (hovered || pressed) && styles.chipRemoveHover]}
      >
        <Ionicons name="close" size={12} color={ACCENT} />
      </Pressable>
    </View>
  );
}

/**
 * One recipient line: chips, a free-text address input, and staff
 * suggestions. Enter, Tab, comma, semicolon, space, or blur commits a typed
 * address; Backspace on an empty input removes the last chip.
 */
function RecipientField({ label, people, onChange, contacts, autoFocus, trailing, excludeEmails }) {
  const [text, setTextState] = useState('');
  const [focused, setFocused] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const inputRef = useRef(null);
  const textRef = useRef('');
  const blurTimer = useRef(null);
  const setText = useCallback((value) => {
    textRef.current = value;
    setTextState(value);
  }, []);
  useEffect(() => () => clearTimeout(blurTimer.current), []);
  const chosen = useMemo(() => new Set(people.map((person) => person.email)), [people]);

  const suggestions = useMemo(() => {
    const q = text.trim().toLowerCase();
    if (!q) return [];
    return (contacts || [])
      .filter((person) => {
        const email = asString(person.email).toLowerCase();
        if (!email || chosen.has(email) || excludeEmails?.has(email)) return false;
        return `${contactName(person)} ${email}`.toLowerCase().includes(q);
      })
      .slice(0, 6);
  }, [chosen, contacts, excludeEmails, text]);

  const add = useCallback(
    (entry) => {
      const person = personFor(entry);
      if (!person.email || chosen.has(person.email)) return true;
      if (!isEmailAddress(person.email)) return false;
      onChange([...people, person]);
      return true;
    },
    [chosen, onChange, people],
  );

  // Reads the ref so a commit from Enter, blur, or submit never sees stale text.
  const commitText = useCallback(() => {
    const raw = textRef.current.trim().replace(/[,;]+$/, '');
    if (!raw) {
      if (textRef.current) setText('');
      return true;
    }
    const ok = add({ email: raw });
    if (ok) setText('');
    setInvalid(!ok);
    return ok;
  }, [add, setText]);

  const pick = (entry) => {
    add(entry);
    setText('');
    setInvalid(false);
    inputRef.current?.focus?.();
  };

  const onKeyPress = (event) => {
    const key = event?.nativeEvent?.key;
    if (key === 'Backspace' && !textRef.current && people.length) {
      onChange(people.slice(0, -1));
      return;
    }
    if (key === 'Enter' || key === 'Tab' || key === ',' || key === ';' || key === ' ') {
      if (!textRef.current.trim()) return;
      if (key !== 'Tab') event?.preventDefault?.();
      if (suggestions.length && key === 'Enter') pick(suggestions[0]);
      else commitText();
    }
  };

  return (
    <View style={[styles.fieldRow, focused && suggestions.length > 0 && styles.fieldRowRaised]}>
      <Pressable style={styles.fieldLabelWrap} onPress={() => inputRef.current?.focus?.()}>
        <Text style={styles.fieldLabel}>{label}</Text>
      </Pressable>
      <View style={styles.fieldBody}>
        <Pressable style={styles.chipRow} onPress={() => inputRef.current?.focus?.()}>
          {people.map((person) => (
            <RecipientChip
              key={person.email}
              person={person}
              onRemove={() => onChange(people.filter((item) => item.email !== person.email))}
            />
          ))}
          <TextInput
            ref={inputRef}
            value={text}
            onChangeText={(value) => {
              setInvalid(false);
              if (/[,;]$/.test(value) && value.trim().length > 1) {
                const ok = add({ email: value.replace(/[,;]+$/, '').trim() });
                if (ok) {
                  setText('');
                  return;
                }
                setInvalid(true);
              }
              setText(value);
            }}
            onKeyPress={onKeyPress}
            onSubmitEditing={commitText}
            onFocus={() => {
              clearTimeout(blurTimer.current);
              setFocused(true);
            }}
            onBlur={() => {
              // Let a tap on a suggestion land before the list closes.
              clearTimeout(blurTimer.current);
              blurTimer.current = setTimeout(() => {
                setFocused(false);
                commitText();
              }, 180);
            }}
            autoFocus={autoFocus}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            blurOnSubmit={false}
            placeholder={people.length ? '' : 'Name or email'}
            placeholderTextColor={SECONDARY}
            style={[styles.recipientInput, invalid && styles.recipientInputInvalid]}
            accessibilityLabel={`${label} recipients`}
          />
        </Pressable>
        {focused && suggestions.length ? (
          <View style={styles.suggestions}>
            {suggestions.map((person) => (
              <Pressable
                key={person.id || person.email}
                onPress={() => pick(person)}
                style={({ hovered, pressed }) => [styles.suggestion, (hovered || pressed) && styles.suggestionHover]}
              >
                <MiniAvatar person={person} size={28} />
                <View style={styles.suggestionCopy}>
                  <Text style={styles.suggestionName} numberOfLines={1}>
                    {contactName(person)}
                  </Text>
                  <Text style={styles.suggestionEmail} numberOfLines={1}>
                    {person.email}
                    {person.locationName ? ` · ${person.locationName}` : ''}
                  </Text>
                </View>
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>
      {trailing}
    </View>
  );
}

function FromPicker({ accounts, value, onChange }) {
  const [open, setOpen] = useState(false);
  const current = accounts.find((account) => account.email === value) || accounts[0];
  if (!current) return null;
  const person = { id: current.email, fullName: current.name || current.email, avatarUrl: current.picture, email: current.email };
  const single = accounts.length <= 1;
  return (
    <View style={[styles.fieldRow, open && styles.fieldRowRaised]}>
      <View style={styles.fieldLabelWrap}>
        <Text style={styles.fieldLabel}>From</Text>
      </View>
      <View style={styles.fieldBody}>
        <Pressable
          onPress={() => (single ? null : setOpen((state) => !state))}
          disabled={single}
          accessibilityRole={single ? undefined : 'button'}
          accessibilityState={single ? undefined : { expanded: open }}
          style={styles.fromButton}
        >
          <MiniAvatar person={person} size={22} />
          <Text style={styles.fromText} numberOfLines={1}>
            {current.name ? `${current.name} <${current.email}>` : current.email}
          </Text>
          {!single ? <Ionicons name="chevron-down" size={14} color={SECONDARY} /> : null}
        </Pressable>
        {open ? (
          <View style={styles.suggestions}>
            {accounts.map((account) => (
              <Pressable
                key={account.email}
                onPress={() => {
                  setOpen(false);
                  onChange(account.email);
                }}
                style={({ hovered, pressed }) => [styles.suggestion, (hovered || pressed) && styles.suggestionHover]}
              >
                <MiniAvatar
                  person={{ id: account.email, fullName: account.name || account.email, avatarUrl: account.picture, email: account.email }}
                  size={28}
                />
                <View style={styles.suggestionCopy}>
                  <Text style={styles.suggestionName} numberOfLines={1}>
                    {account.name || account.email}
                  </Text>
                  <Text style={styles.suggestionEmail} numberOfLines={1}>
                    {account.email}
                  </Text>
                </View>
                {account.email === current.email ? <Ionicons name="checkmark" size={16} color={ACCENT} /> : null}
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>
    </View>
  );
}

/**
 * Compose, reply, reply-all, or forward from a connected inbox. The proxy adds
 * the Gmail signature and threading headers; this only collects the fields.
 */
export default function EmailComposer({
  draft,
  accounts,
  initialAccount,
  contacts,
  isMobile,
  onClose,
  onSent,
  onReconnect,
}) {
  const connected = useMemo(() => (accounts || []).filter((account) => account.connected), [accounts]);
  const [from, setFrom] = useState(initialAccount || connected[0]?.email || '');
  const [to, setTo] = useState(() => (draft?.to || []).map(personFor));
  const [cc, setCc] = useState(() => (draft?.cc || []).map(personFor));
  const [bcc, setBcc] = useState(() => (draft?.bcc || []).map(personFor));
  const [showCc, setShowCc] = useState(() => (draft?.cc || []).length > 0);
  const [showBcc, setShowBcc] = useState(false);
  const [subject, setSubject] = useState(draft?.subject || '');
  const [body, setBody] = useState('');
  const [includeSignature, setIncludeSignature] = useState(true);
  const [signature, setSignature] = useState({ loading: true, text: '', canSend: true });
  const [quoteOpen, setQuoteOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [scopeMissing, setScopeMissing] = useState(false);
  const bodyRef = useRef(null);
  const mode = draft?.mode || 'new';
  const isReply = mode === 'reply' || mode === 'replyAll';
  const ownEmails = useMemo(() => new Set(connected.map((account) => account.email)), [connected]);

  useEffect(() => {
    if (!from && connected[0]?.email) setFrom(connected[0].email);
  }, [connected, from]);

  useEffect(() => {
    if (!from) return undefined;
    let cancelled = false;
    setSignature((current) => ({ ...current, loading: true }));
    setScopeMissing(false);
    getGmailSignature(from)
      .then((result) => {
        if (cancelled) return;
        setSignature({ loading: false, text: result.signatureText, canSend: result.canSend });
        if (!result.canSend) setScopeMissing(true);
      })
      .catch(() => {
        if (!cancelled) setSignature({ loading: false, text: '', canSend: true });
      });
    return () => {
      cancelled = true;
    };
  }, [from]);

  useEffect(() => {
    if (isReply) {
      const timer = setTimeout(() => bodyRef.current?.focus?.(), 60);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [isReply]);

  const recipientCount = to.length + cc.length + bcc.length;
  const canSend = recipientCount > 0 && body.trim().length > 0 && !sending && Boolean(from) && !scopeMissing;

  const send = async () => {
    if (!canSend) {
      if (!recipientCount) setError('Add at least one recipient.');
      else if (!body.trim()) setError('Write a message first.');
      return;
    }
    setSending(true);
    setError('');
    try {
      const result = await sendGmailMessage({
        account: from,
        to,
        cc,
        bcc,
        subject,
        text: body,
        reply: draft?.reply,
        quoted: draft?.quoted,
        includeSignature: includeSignature && Boolean(signature.text),
      });
      onSent?.({ ...result, mode, subject, to, cc, bcc });
    } catch (err) {
      if (isGmailSendScopeMissing(err)) {
        setScopeMissing(true);
        setError(err.message);
      } else if (isGmailNotConnected(err)) {
        setError(err.message || 'Reconnect this inbox, then try again.');
      } else {
        setError(err?.message || 'Could not send that email.');
      }
    } finally {
      setSending(false);
    }
  };

  const recipientsSummary = useMemo(() => {
    const all = [...to, ...cc, ...bcc];
    if (!all.length) return '';
    const names = all.map((person) => (person.fullName && person.fullName !== person.email ? person.fullName.split(' ')[0] : person.email));
    return names.length <= 3 ? names.join(', ') : `${names.slice(0, 3).join(', ')} +${names.length - 3}`;
  }, [bcc, cc, to]);

  const ccBccToggles = !showCc || !showBcc ? (
    <View style={styles.ccToggles}>
      {!showCc ? (
        <Pressable onPress={() => setShowCc(true)} hitSlop={6} accessibilityRole="button">
          <Text style={styles.ccToggle}>Cc</Text>
        </Pressable>
      ) : null}
      {!showBcc ? (
        <Pressable onPress={() => setShowBcc(true)} hitSlop={6} accessibilityRole="button">
          <Text style={styles.ccToggle}>Bcc</Text>
        </Pressable>
      ) : null}
    </View>
  ) : null;

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.header}>
        {isMobile ? (
          <Pressable onPress={onClose} style={styles.backButton} accessibilityLabel="Discard" accessibilityRole="button">
            <Ionicons name="chevron-back" size={22} color="#0A84FF" />
          </Pressable>
        ) : null}
        <View style={styles.headerCopy}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {MODE_TITLES[mode] || MODE_TITLES.new}
          </Text>
          <Text style={styles.headerSub} numberOfLines={1}>
            {recipientsSummary ? `To ${recipientsSummary}` : isReply ? draft?.subject || '' : 'Sent from your Canada Gold inbox'}
          </Text>
        </View>
        {!isMobile ? (
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Discard draft"
            style={({ hovered, pressed }) => [styles.iconButton, (hovered || pressed) && styles.iconButtonHover]}
          >
            <Ionicons name="close" size={18} color={SECONDARY} />
          </Pressable>
        ) : null}
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.card}>
          {connected.length > 1 ? <FromPicker accounts={connected} value={from} onChange={setFrom} /> : null}
          <RecipientField
            label="To"
            people={to}
            onChange={setTo}
            contacts={contacts}
            autoFocus={!isReply && Platform.OS === 'web'}
            trailing={ccBccToggles}
            excludeEmails={ownEmails}
          />
          {showCc ? <RecipientField label="Cc" people={cc} onChange={setCc} contacts={contacts} excludeEmails={ownEmails} /> : null}
          {showBcc ? <RecipientField label="Bcc" people={bcc} onChange={setBcc} contacts={contacts} excludeEmails={ownEmails} /> : null}
          <View style={styles.fieldRow}>
            <View style={styles.fieldLabelWrap}>
              <Text style={styles.fieldLabel}>Subject</Text>
            </View>
            <TextInput
              value={subject}
              onChangeText={setSubject}
              placeholder="Subject"
              placeholderTextColor={SECONDARY}
              style={styles.subjectInput}
              accessibilityLabel="Subject"
            />
          </View>

          <TextInput
            ref={bodyRef}
            value={body}
            onChangeText={setBody}
            placeholder={isReply ? 'Write your reply…' : 'Write your email…'}
            placeholderTextColor={SECONDARY}
            multiline
            textAlignVertical="top"
            scrollEnabled={false}
            style={styles.body}
            accessibilityLabel="Message body"
          />

          {signature.loading ? (
            <View style={styles.signatureBlock}>
              <ActivityIndicator size="small" color={SECONDARY} />
            </View>
          ) : signature.text ? (
            <Pressable
              onPress={() => setIncludeSignature((state) => !state)}
              accessibilityRole="switch"
              accessibilityState={{ checked: includeSignature }}
              style={[styles.signatureBlock, !includeSignature && styles.signatureBlockOff]}
            >
              <View style={styles.signatureHead}>
                <Ionicons
                  name={includeSignature ? 'checkmark-circle' : 'ellipse-outline'}
                  size={16}
                  color={includeSignature ? ACCENT : '#c7c7cc'}
                />
                <Text style={styles.signatureLabel}>
                  {includeSignature ? 'Signature' : 'Signature off'}
                </Text>
              </View>
              {includeSignature ? (
                <Text style={styles.signatureText} numberOfLines={6}>
                  {signature.text}
                </Text>
              ) : null}
            </Pressable>
          ) : null}

          {draft?.quoted?.text ? (
            <View style={styles.quoteBlock}>
              <Pressable
                onPress={() => setQuoteOpen((state) => !state)}
                accessibilityRole="button"
                accessibilityState={{ expanded: quoteOpen }}
                style={styles.quoteToggle}
              >
                <Ionicons name="ellipsis-horizontal" size={16} color={SECONDARY} />
                <Text style={styles.quoteToggleText} numberOfLines={1}>
                  {quoteOpen ? 'Hide quoted text' : draft.quoted.header.split('\n')[0] || 'Quoted text'}
                </Text>
              </Pressable>
              {quoteOpen ? (
                <View style={styles.quoteBody}>
                  <Text style={styles.quoteHeader}>{draft.quoted.header}</Text>
                  <Text style={styles.quoteText}>{draft.quoted.text}</Text>
                </View>
              ) : null}
            </View>
          ) : null}
        </View>
      </ScrollView>

      {error || scopeMissing ? (
        <View style={styles.errorBar}>
          <Ionicons name="alert-circle-outline" size={16} color="#b91c1c" />
          <Text style={styles.errorText}>
            {error || 'This inbox needs permission to send. Connect it again and allow sending.'}
          </Text>
          {scopeMissing && onReconnect ? (
            <Pressable onPress={() => onReconnect(from)} style={styles.errorAction} accessibilityRole="button">
              <Text style={styles.errorActionText}>Allow sending</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      <View style={styles.footer}>
        <Pressable
          onPress={send}
          disabled={!canSend}
          accessibilityRole="button"
          accessibilityLabel="Send"
          style={({ hovered, pressed }) => [
            styles.sendButton,
            (hovered || pressed) && canSend && styles.sendButtonHover,
            !canSend && styles.sendButtonDisabled,
          ]}
        >
          {sending ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <>
              <Text style={styles.sendButtonText}>Send</Text>
              <Ionicons name="paper-plane" size={14} color="#fff" />
            </>
          )}
        </Pressable>
        <Text style={styles.footerHint} numberOfLines={1}>
          {from ? `from ${from}` : ''}
        </Text>
        {!isMobile ? (
          <Pressable onPress={onClose} accessibilityRole="button" style={styles.discardButton}>
            <Ionicons name="trash-outline" size={16} color={SECONDARY} />
            <Text style={styles.discardText}>Discard</Text>
          </Pressable>
        ) : null}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    backgroundColor: '#fff',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: HAIRLINE,
  },
  headerCopy: {
    flex: 1,
    minWidth: 0,
  },
  headerTitle: {
    fontFamily,
    fontSize: 16,
    fontWeight: '600',
    color: INK,
  },
  headerSub: {
    fontFamily,
    fontSize: 12,
    color: SECONDARY,
    marginTop: 1,
  },
  backButton: {
    width: 28,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({ web: { cursor: 'pointer' }, default: {} }),
  },
  iconButtonHover: {
    backgroundColor: FIELD_BG,
  },
  scroll: {
    flex: 1,
    minHeight: 0,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 24,
  },
  card: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: HAIRLINE,
    backgroundColor: '#fff',
    overflow: 'visible',
    ...Platform.select({
      web: { boxShadow: '0 1px 2px rgba(0,0,0,0.04), 0 8px 24px rgba(0,0,0,0.04)' },
      default: {},
    }),
  },
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 6,
    minHeight: 44,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: HAIRLINE,
  },
  // Only the row with an open dropdown gets a z-index, so later rows cannot paint over it.
  fieldRowRaised: {
    zIndex: 20,
  },
  fieldLabelWrap: {
    width: 56,
    paddingTop: 9,
  },
  fieldLabel: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: SECONDARY,
  },
  fieldBody: {
    flex: 1,
    minWidth: 0,
    position: 'relative',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
    minHeight: 32,
    paddingVertical: 2,
    ...Platform.select({ web: { cursor: 'text' }, default: {} }),
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 28,
    paddingLeft: 3,
    paddingRight: 4,
    borderRadius: 14,
    backgroundColor: '#eef0ff',
    maxWidth: 260,
  },
  chipText: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: ACCENT,
    flexShrink: 1,
  },
  chipRemove: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({ web: { cursor: 'pointer' }, default: {} }),
  },
  chipRemoveHover: {
    backgroundColor: '#dcdfff',
  },
  recipientInput: {
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 140,
    height: 28,
    fontFamily,
    fontSize: 15,
    color: INK,
    paddingVertical: 0,
    outlineStyle: 'none',
  },
  recipientInputInvalid: {
    color: '#b91c1c',
  },
  suggestions: {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    marginTop: 4,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: '#fff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0,0,0,0.08)',
    zIndex: 50,
    ...Platform.select({
      web: { boxShadow: '0 10px 30px rgba(0,0,0,0.12)' },
      default: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.12,
        shadowRadius: 14,
        elevation: 6,
      },
    }),
  },
  suggestion: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 10,
    paddingVertical: 7,
    ...Platform.select({ web: { cursor: 'pointer' }, default: {} }),
  },
  suggestionHover: {
    backgroundColor: FIELD_BG,
  },
  suggestionCopy: {
    flex: 1,
    minWidth: 0,
  },
  suggestionName: {
    fontFamily,
    fontSize: 14,
    fontWeight: '600',
    color: INK,
  },
  suggestionEmail: {
    fontFamily,
    fontSize: 12,
    color: SECONDARY,
    marginTop: 1,
  },
  ccToggles: {
    flexDirection: 'row',
    gap: 10,
    paddingTop: 9,
  },
  ccToggle: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: SECONDARY,
  },
  fromButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 32,
    ...Platform.select({ web: { cursor: 'pointer' }, default: {} }),
  },
  fromText: {
    flexShrink: 1,
    fontFamily,
    fontSize: 15,
    color: INK,
  },
  subjectInput: {
    flex: 1,
    minHeight: 32,
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: INK,
    paddingVertical: 0,
    outlineStyle: 'none',
  },
  body: {
    minHeight: 220,
    fontFamily,
    fontSize: 16,
    lineHeight: 24,
    color: INK,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
    outlineStyle: 'none',
  },
  signatureBlock: {
    marginHorizontal: 16,
    marginBottom: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: FIELD_BG,
    gap: 6,
    ...Platform.select({ web: { cursor: 'pointer' }, default: {} }),
  },
  signatureBlockOff: {
    backgroundColor: 'transparent',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: HAIRLINE,
  },
  signatureHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  signatureLabel: {
    fontFamily,
    fontSize: 12,
    fontWeight: '600',
    color: SECONDARY,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  signatureText: {
    fontFamily,
    fontSize: 14,
    lineHeight: 20,
    color: '#3a3a3c',
  },
  quoteBlock: {
    marginHorizontal: 16,
    marginBottom: 16,
  },
  quoteToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: FIELD_BG,
    maxWidth: '100%',
    ...Platform.select({ web: { cursor: 'pointer' }, default: {} }),
  },
  quoteToggleText: {
    fontFamily,
    fontSize: 12,
    color: SECONDARY,
    flexShrink: 1,
  },
  quoteBody: {
    marginTop: 10,
    paddingLeft: 12,
    borderLeftWidth: 2,
    borderLeftColor: '#d1d1d6',
    gap: 6,
  },
  quoteHeader: {
    fontFamily,
    fontSize: 13,
    color: SECONDARY,
  },
  quoteText: {
    fontFamily,
    fontSize: 14,
    lineHeight: 21,
    color: '#636366',
  },
  errorBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 10,
    backgroundColor: '#FEF2F2',
  },
  errorText: {
    flex: 1,
    fontFamily,
    fontSize: 13,
    lineHeight: 18,
    color: '#b91c1c',
  },
  errorAction: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#b91c1c',
    ...Platform.select({ web: { cursor: 'pointer' }, default: {} }),
  },
  errorActionText: {
    fontFamily,
    fontSize: 12,
    fontWeight: '700',
    color: '#fff',
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: HAIRLINE,
  },
  sendButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 38,
    paddingHorizontal: 18,
    borderRadius: 999,
    backgroundColor: ACCENT,
    ...Platform.select({ web: { cursor: 'pointer' }, default: {} }),
  },
  sendButtonHover: {
    backgroundColor: '#3730A3',
  },
  sendButtonDisabled: {
    opacity: 0.45,
  },
  sendButtonText: {
    fontFamily,
    fontSize: 15,
    fontWeight: '700',
    color: '#fff',
  },
  footerHint: {
    flex: 1,
    fontFamily,
    fontSize: 12,
    color: SECONDARY,
  },
  discardButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    ...Platform.select({ web: { cursor: 'pointer' }, default: {} }),
  },
  discardText: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: SECONDARY,
  },
  avatar: {
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitials: {
    fontFamily,
    fontWeight: '700',
    color: '#fff',
  },
});
