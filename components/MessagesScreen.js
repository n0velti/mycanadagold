import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AvatarRing } from '../lib/clockedIn';
import {
  addDmGroupMembers,
  avatarColorForId,
  contactName,
  conversationSubtitle,
  conversationTitle,
  createDmGroup,
  formatInboxTime,
  formatLastSeen,
  formatThreadStamp,
  getOrCreateAiDm,
  getOrCreateDm,
  getOrCreateTeamDm,
  hideDmConversation,
  hideDmMessage,
  initialsFromName,
  leaveDmGroup,
  listDmContacts,
  listDmInbox,
  listDmMessages,
  markDmRead,
  renameDmGroup,
  saveAiDmChat,
  sendDmMessage,
  shouldShowStamp,
  subscribeDmRealtime,
  subscribeDmTyping,
  toggleDmLike,
  unhideDmConversation,
} from '../lib/messages';
import { intakeNames, listTeams } from '../lib/teams';
import { prepareAiChatSession, sendAiChatMessage, titleAiChat } from '../lib/aiChat';
import { OPENROUTER_MODELS } from '../lib/openrouter';
import { CANVAS } from '../lib/mobileUi';
import ProfilePhotoModal from './ProfilePhotoModal';

const fontFamily = Platform.select({
  ios: 'Sohne',
  android: 'Sohne',
  default: 'Sohne',
});

const BLUE = '#0A84FF';
const INBOX_WIDTH = 340;
const MOBILE_BREAKPOINT = 768;
const AI_MODEL =
  OPENROUTER_MODELS.find((model) => model.key === 'anthropic/claude-sonnet-5')?.key ||
  OPENROUTER_MODELS[0]?.key ||
  '';

const EMOJI_GROUPS = [
  {
    key: 'smileys',
    label: '😀',
    emojis: [
      '😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣', '😊', '😇',
      '🙂', '😉', '😍', '🥰', '😘', '😋', '😜', '🤔', '😴', '😎',
      '🤩', '🥳', '😤', '😭', '😡', '🤯', '🥶', '🤠', '😈', '👻',
    ],
  },
  {
    key: 'gestures',
    label: '👍',
    emojis: [
      '👍', '👎', '👏', '🙌', '🤝', '✌️', '🤞', '🤟', '👌', '🤙',
      '🙏', '💪', '🫶', '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤',
      '💯', '✨', '🔥', '⭐', '🎉', '✅', '❌', '⚠️', '📌', '💬',
    ],
  },
  {
    key: 'work',
    label: '💼',
    emojis: [
      '🥇', '🥈', '🥉', '🏆', '📈', '📉', '💰', '💵', '💎', '🪙',
      '📦', '🚚', '🏪', '🧾', '📊', '📅', '⏰', '📍', '🔔', '📝',
      '☕', '🍩', '🍕', '🎂', '☀️', '🌙', '❄️', '🌧️', '🏁', '🚀',
    ],
  },
];

function useIsMobile() {
  const { width } = useWindowDimensions();
  return width < MOBILE_BREAKPOINT;
}

function PersonAvatar({ person, size = 40, showOnline = false }) {
  const [failed, setFailed] = useState(false);
  const name = contactName(person);
  const initials = initialsFromName(name);
  const color = avatarColorForId(person?.id || name);
  const uri = person?.avatarUrl;
  const showImage = Boolean(uri) && !failed;
  const dot = Math.max(10, Math.round(size * 0.28));

  useEffect(() => {
    setFailed(false);
  }, [uri]);

  return (
    <View style={{ width: size, height: size }}>
      <AvatarRing name={name} size={size}>
      <View
        style={[
          styles.avatar,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: showImage ? '#e8e8ed' : color,
          },
        ]}
      >
        {showImage ? (
          <Image
            source={{ uri }}
            style={{ width: size, height: size }}
            onError={() => setFailed(true)}
          />
        ) : (
          <Text style={[styles.avatarInitials, { fontSize: Math.max(11, Math.round(size * 0.36)) }]}>
            {initials || '?'}
          </Text>
        )}
      </View>
      </AvatarRing>
      {showOnline && person?.isOnline ? (
        <View
          style={[
            styles.onlineDot,
            { width: dot, height: dot, borderRadius: dot / 2, right: 0, bottom: 0 },
          ]}
        />
      ) : null}
    </View>
  );
}

function firstNameOf(person) {
  const first = String(person?.firstName || '').trim();
  if (first) return first;
  return contactName(person).split(/\s+/)[0] || 'Teammate';
}

function ConversationAvatar({ conversation, size = 52 }) {
  if (conversation?.isAi) {
    return (
      <View
        style={[
          styles.avatar,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: '#6B4DE6',
          },
        ]}
      >
        <Ionicons name="sparkles" size={Math.max(16, Math.round(size * 0.42))} color="#fff" />
      </View>
    );
  }
  if (conversation?.isTeam) {
    return (
      <View
        style={[
          styles.avatar,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: BLUE,
          },
        ]}
      >
        <Ionicons name="people" size={Math.max(16, Math.round(size * 0.46))} color="#fff" />
      </View>
    );
  }
  const members = conversation?.members || (conversation?.other ? [conversation.other] : []);
  if (!conversation?.isGroup) {
    return <PersonAvatar person={members[0]} size={size} showOnline />;
  }
  const people = members.slice(0, 2);
  const inner = Math.max(22, Math.round(size * 0.66));
  return (
    <View style={{ width: size, height: size }}>
      {people[1] ? (
        <View style={{ position: 'absolute', right: 0, top: 0 }}>
          <PersonAvatar person={people[1]} size={inner} />
        </View>
      ) : null}
      <View style={{ position: 'absolute', left: 0, bottom: people[1] ? 0 : (size - inner) / 2 }}>
        <PersonAvatar person={people[0]} size={inner} />
      </View>
    </View>
  );
}

function HeartBurst({ trigger }) {
  const scale = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!trigger) return undefined;
    scale.setValue(0.4);
    opacity.setValue(1);
    const animation = Animated.parallel([
      Animated.spring(scale, { toValue: 1.15, friction: 5, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 0, duration: 700, delay: 280, useNativeDriver: true }),
    ]);
    animation.start();
    return () => animation.stop();
  }, [trigger, scale, opacity]);

  if (!trigger) return null;
  return (
    <Animated.Text
      pointerEvents="none"
      style={[styles.heartBurst, { opacity, transform: [{ scale }] }]}
    >
      ❤️
    </Animated.Text>
  );
}

function confirmDeleteForMe(onConfirm) {
  const title = 'Delete for you?';
  const body = 'This message will be removed from your chat. The other person will still see it.';
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && window.confirm(`${title}\n\n${body}`)) onConfirm();
    return;
  }
  Alert.alert(title, body, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: onConfirm },
  ]);
}

function confirmDeleteConversation(thread, onConfirm) {
  const title = 'Delete chat?';
  const kept = thread?.isAi
    ? ''
    : thread?.isGroup
      ? 'Everyone else will still have it.'
      : `${conversationTitle(thread)} will still have it.`;
  const body = kept
    ? `This chat will be removed from your messages. ${kept}`
    : 'This chat will be removed from your messages.';
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && window.confirm(`${title}\n\n${body}`)) onConfirm();
    return;
  }
  Alert.alert(title, body, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: onConfirm },
  ]);
}

function mergeSentMessage(current, localKey, tempId, saved) {
  const index = current.findIndex((item) => item.localKey === localKey || item.id === tempId);
  if (index === -1) {
    if (current.some((item) => item.id === saved.id)) return current;
    return [...current, saved];
  }
  const next = current.slice();
  next[index] = {
    ...saved,
    localKey: current[index].localKey || localKey,
    justSent: current[index].justSent,
  };
  return next.filter((item, itemIndex) => item.id !== saved.id || itemIndex === index);
}

function AppleSend({ active, onSettled, children }) {
  const progress = useRef(new Animated.Value(active ? 0 : 1)).current;
  const sizeRef = useRef({ width: 0, height: 0 });
  const onSettledRef = useRef(onSettled);
  const [ready, setReady] = useState(false);
  onSettledRef.current = onSettled;

  useEffect(() => {
    if (!active || !ready) return undefined;
    progress.setValue(0);
    const animation = Animated.spring(progress, {
      toValue: 1,
      stiffness: 340,
      damping: 22,
      mass: 0.65,
      useNativeDriver: true,
    });
    animation.start(({ finished }) => {
      if (finished) onSettledRef.current?.();
    });
    return () => animation.stop();
  }, [active, ready, progress]);

  if (!active) return children;

  const { width, height } = sizeRef.current;
  const scale = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0.28, 1],
  });
  const lift = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [14, 0],
  });
  const opacity = progress.interpolate({
    inputRange: [0, 0.12, 1],
    outputRange: [0, 1, 1],
  });

  return (
    <Animated.View
      pointerEvents="box-none"
      onLayout={(event) => {
        const next = event.nativeEvent.layout;
        if (next.width <= 0 || next.height <= 0) return;
        sizeRef.current = { width: next.width, height: next.height };
        if (!ready) setReady(true);
      }}
      style={{
        alignSelf: 'stretch',
        opacity: ready ? opacity : 0,
        transform: [
          { translateY: lift },
          { translateX: width / 2 },
          { translateY: height / 2 },
          { scale },
          { translateX: -width / 2 },
          { translateY: -height / 2 },
        ],
      }}
    >
      {children}
    </Animated.View>
  );
}

function MessageBubble({
  message,
  mine,
  groupedWithPrev,
  groupedWithNext,
  senderLabel,
  menuOpen,
  onOpenMenu,
  onCloseMenu,
  onToggleLike,
  onDeleteForMe,
  onSendSettled,
}) {
  const lastTap = useRef(0);
  const [burst, setBurst] = useState(0);
  const [hovered, setHovered] = useState(false);
  const radius = 18;
  const cluster = {
    borderTopLeftRadius: !mine && groupedWithPrev ? 6 : radius,
    borderBottomLeftRadius: !mine && groupedWithNext ? 6 : radius,
    borderTopRightRadius: mine && groupedWithPrev ? 6 : radius,
    borderBottomRightRadius: mine && groupedWithNext ? 6 : radius,
  };
  const showMore = Platform.OS === 'web' && (hovered || menuOpen);

  const handlePress = () => {
    if (menuOpen) {
      onCloseMenu();
      return;
    }
    const now = Date.now();
    if (now - lastTap.current < 320) {
      lastTap.current = 0;
      if (!message.likedByMe) setBurst((current) => current + 1);
      onToggleLike(message);
      return;
    }
    lastTap.current = now;
  };

  const openMenu = (event) => {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    onOpenMenu(message);
  };

  return (
    <AppleSend active={Boolean(message.justSent)} onSettled={() => onSendSettled?.(message)}>
    <View
      style={[styles.bubbleRow, mine ? styles.bubbleRowMine : styles.bubbleRowTheirs, message.likeCount > 0 && styles.bubbleRowLiked]}
      {...(Platform.OS === 'web'
        ? {
            onMouseEnter: () => setHovered(true),
            onMouseLeave: () => setHovered(false),
          }
        : null)}
    >
      {senderLabel && !groupedWithPrev ? (
        <Text style={styles.senderLabel} numberOfLines={1}>
          {senderLabel}
        </Text>
      ) : null}
      <View style={[styles.bubbleStack, mine && styles.bubbleStackMine]}>
        {menuOpen ? (
          <View
            style={[styles.msgMenu, mine ? styles.msgMenuMine : styles.msgMenuTheirs]}
            {...(Platform.OS === 'web' ? { onClick: (event) => event.stopPropagation() } : null)}
          >
            <Pressable
              onPress={() => {
                if (!message.likedByMe) setBurst((current) => current + 1);
                onToggleLike(message);
                onCloseMenu();
              }}
              style={({ hovered: itemHover, pressed }) => [
                styles.msgMenuItem,
                (itemHover || pressed) && styles.msgMenuItemHover,
              ]}
            >
              <Text style={styles.msgMenuText}>{message.likedByMe ? 'Unlike' : 'Like'}</Text>
            </Pressable>
            <View style={styles.msgMenuDivider} />
            <Pressable
              onPress={() => {
                onCloseMenu();
                confirmDeleteForMe(() => onDeleteForMe(message));
              }}
              style={({ hovered: itemHover, pressed }) => [
                styles.msgMenuItem,
                (itemHover || pressed) && styles.msgMenuItemHover,
              ]}
            >
              <Text style={[styles.msgMenuText, styles.msgMenuDanger]}>Delete for you</Text>
            </Pressable>
          </View>
        ) : null}
        <View style={[styles.bubbleLine, mine && styles.bubbleLineMine]}>
          <Pressable
            onPress={handlePress}
            onLongPress={openMenu}
            delayLongPress={280}
            {...(Platform.OS === 'web' ? { onContextMenu: openMenu } : null)}
            style={({ hovered: bubbleHover }) => [
              styles.bubble,
              mine ? styles.bubbleMine : styles.bubbleTheirs,
              cluster,
              bubbleHover && !mine && styles.bubbleHoverTheirs,
              bubbleHover && mine && styles.bubbleHoverMine,
            ]}
          >
            <Text style={[styles.bubbleText, mine && styles.bubbleTextMine]}>{message.body}</Text>
            <HeartBurst trigger={burst} />
          </Pressable>
          {showMore ? (
            <Pressable
              onPress={openMenu}
              style={({ hovered: moreHover, pressed }) => [
                styles.bubbleMore,
                (moreHover || pressed) && styles.bubbleMoreHover,
              ]}
              accessibilityLabel="Message actions"
            >
              <Ionicons name="ellipsis-horizontal" size={16} color="#8e8e93" />
            </Pressable>
          ) : null}
        </View>
      </View>
      {message.likeCount > 0 ? (
        <View style={[styles.likeBadge, mine ? styles.likeBadgeMine : styles.likeBadgeTheirs]}>
          <Text style={styles.likeBadgeText}>
            ❤️{message.likeCount > 1 ? ` ${message.likeCount}` : ''}
          </Text>
        </View>
      ) : null}
    </View>
    </AppleSend>
  );
}

function TypingDots() {
  const a = useRef(new Animated.Value(0.3)).current;
  const b = useRef(new Animated.Value(0.3)).current;
  const c = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    const pulse = (value, delay) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(value, { toValue: 1, duration: 280, useNativeDriver: true }),
          Animated.timing(value, { toValue: 0.3, duration: 280, useNativeDriver: true }),
        ]),
      );
    const anim = Animated.parallel([pulse(a, 0), pulse(b, 140), pulse(c, 280)]);
    anim.start();
    return () => anim.stop();
  }, [a, b, c]);

  return (
    <View style={styles.typingBubble}>
      {[a, b, c].map((value, index) => (
        <Animated.View key={index} style={[styles.typingDot, { opacity: value }]} />
      ))}
    </View>
  );
}

function EmojiPicker({ visible, onPick }) {
  const [group, setGroup] = useState(EMOJI_GROUPS[0].key);
  const active = EMOJI_GROUPS.find((item) => item.key === group) || EMOJI_GROUPS[0];
  if (!visible) return null;

  return (
    <View style={styles.emojiPanel}>
      <View style={styles.emojiTabs}>
        {EMOJI_GROUPS.map((item) => (
          <Pressable
            key={item.key}
            onPress={() => setGroup(item.key)}
            style={[styles.emojiTab, item.key === group && styles.emojiTabActive]}
          >
            <Text style={styles.emojiTabLabel}>{item.label}</Text>
          </Pressable>
        ))}
      </View>
      <ScrollView style={styles.emojiGrid} keyboardShouldPersistTaps="handled">
        <View style={styles.emojiGridInner}>
          {active.emojis.map((emoji) => (
            <Pressable
              key={emoji}
              onPress={() => onPick(emoji)}
              style={({ hovered, pressed }) => [
                styles.emojiCell,
                (hovered || pressed) && styles.emojiCellHover,
              ]}
            >
              <Text style={styles.emojiGlyph}>{emoji}</Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

function AiDmPanel({ session, onClose, onSaved, dismissRef }) {
  const [status, setStatus] = useState('ready');
  const [progress, setProgress] = useState('');
  const [seedMessages, setSeedMessages] = useState([]);
  const [chatContext, setChatContext] = useState(null);
  const [turns, setTurns] = useState([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const listRef = useRef(null);

  useEffect(() => {
    if (!session?.token) {
      setStatus('idle');
      setSeedMessages([]);
      setChatContext(null);
      return;
    }
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - 6);
    const prepared = prepareAiChatSession({ startDate: start, endDate: end });
    setSeedMessages(prepared.seedMessages);
    setChatContext(prepared.context);
    setStatus('ready');
    setProgress('');
    setError('');
  }, [session]);

  const send = async () => {
    const text = draft.trim();
    if (!text || busy || status !== 'ready') return;
    setDraft('');
    setBusy(true);
    setError('');
    setProgress('Choosing data…');
    const nextTurns = [...turns, { role: 'user', content: text }];
    setTurns(nextTurns);
    try {
      const result = await sendAiChatMessage({
        seedMessages,
        turns,
        userMessage: text,
        model: AI_MODEL,
        session,
        context: chatContext,
        startDate: chatContext?.selection?.startDate,
        endDate: chatContext?.selection?.endDate,
        onLookup: (label) => setProgress(label || ''),
      });
      if (result.sources?.length) {
        setChatContext((current) =>
          current ? { ...current, lastSources: result.sources } : current,
        );
      }
      setTurns(result.turns || [...nextTurns, { role: 'assistant', content: result.text || '' }]);
    } catch (err) {
      setError(err.message || 'Could not get an answer.');
    } finally {
      setBusy(false);
      setProgress('');
      requestAnimationFrame(() => listRef.current?.scrollToEnd?.({ animated: true }));
    }
  };

  const exit = async () => {
    if (saving) return;
    const snapshot = turns.filter(
      (turn) => (turn.role === 'user' || turn.role === 'assistant') && String(turn.content || '').trim(),
    );
    if (!snapshot.some((turn) => turn.role === 'user')) {
      onClose();
      return;
    }
    setSaving(true);
    setError('');
    try {
      const title = await titleAiChat(snapshot, AI_MODEL);
      await saveAiDmChat(title, snapshot);
      if (onSaved) await onSaved();
      onClose();
    } catch (err) {
      setSaving(false);
      setError(err.message || 'Could not save this chat.');
    }
  };

  const exitRef = useRef(exit);
  exitRef.current = exit;

  useEffect(() => {
    if (!dismissRef) return undefined;
    const dismiss = () => exitRef.current?.();
    dismissRef.current = dismiss;
    return () => {
      if (dismissRef.current === dismiss) dismissRef.current = null;
    };
  }, [dismissRef]);

  return (
    <View style={styles.aiPanel}>
      <View style={styles.aiHeader}>
        <Pressable
          onPress={() => void exit()}
          hitSlop={8}
          style={styles.aiBack}
          accessibilityLabel="Back to messages"
        >
          <Ionicons name="chevron-back" size={22} color={BLUE} />
        </Pressable>
        <View style={styles.aiHeaderCopy}>
          <Text style={styles.aiTitle}>{saving ? 'Saving chat…' : 'MyCanadaGold AI'}</Text>
        </View>
      </View>
      <ScrollView
        ref={listRef}
        style={styles.aiList}
        contentContainerStyle={styles.aiListContent}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => listRef.current?.scrollToEnd?.({ animated: false })}
      >
        {status === 'loading' ? (
          <View style={styles.aiEmpty}>
            <ActivityIndicator color="#1d1d1f" />
            <Text style={styles.emptyHint}>{progress}</Text>
          </View>
        ) : turns.length === 0 ? (
          <View style={styles.aiEmpty}>
            <Ionicons name="sparkles" size={28} color={BLUE} />
            <Text style={styles.aiEmptyTitle}>Ask about the company</Text>
            <Text style={styles.emptyHint}>
              Ask about tills, sales, stock, or staff. Only that data is loaded.
            </Text>
          </View>
        ) : (
          turns.map((turn, index) => (
            <View
              key={`${turn.role}-${index}`}
              style={[styles.aiBubble, turn.role === 'user' ? styles.aiBubbleMine : styles.aiBubbleThem]}
            >
              <Text style={[styles.aiBubbleText, turn.role === 'user' && styles.aiBubbleTextMine]}>
                {turn.content}
              </Text>
            </View>
          ))
        )}
        {busy ? <ActivityIndicator color="#8e8e93" style={styles.aiBusy} /> : null}
      </ScrollView>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      <View style={[styles.composer, styles.composerMobile]}>
        <View style={[styles.composerField, styles.aiComposerField]}>
          <TextInput
            style={[styles.composerInput, styles.aiComposerInput]}
            value={draft}
            onChangeText={setDraft}
            placeholder={status === 'ready' ? 'Message MyCanadaGold AI' : 'Loading…'}
            placeholderTextColor="#8e8e93"
            editable={status === 'ready' && !busy}
            multiline={false}
            numberOfLines={1}
            returnKeyType="send"
            maxLength={4000}
            blurOnSubmit
            onSubmitEditing={send}
            onKeyPress={(event) => {
              const key = event?.nativeEvent?.key || event?.key;
              if (key !== 'Enter') return;
              event.preventDefault?.();
              if (draft.trim() && status === 'ready' && !busy) send();
            }}
          />
        </View>
        <Pressable
          onPress={send}
          disabled={!draft.trim() || busy || status !== 'ready'}
          style={[
            styles.sendButton,
            draft.trim() && status === 'ready' && !busy ? styles.sendButtonOn : styles.sendButtonOff,
          ]}
          accessibilityLabel="Send"
        >
          <Ionicons name="arrow-up" size={18} color="#fff" />
        </Pressable>
      </View>
    </View>
  );
}

export default function MessagesScreen({
  session,
  onUnreadChange,
  openUserId,
  onOpenedUser,
  onOpenProfile,
}) {
  const isMobile = useIsMobile();
  const myId = session?.supabaseUserId || session?.profile?.id || '';
  const myName =
    session?.profile?.fullName ||
    [session?.profile?.firstName, session?.profile?.lastName].filter(Boolean).join(' ') ||
    'You';
  const [inbox, setInbox] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [teams, setTeams] = useState([]);
  const [query, setQuery] = useState('');
  const [composeOpen, setComposeOpen] = useState(false);
  const aiSessionsRef = useRef(new Map());
  const [selectedIds, setSelectedIds] = useState([]);
  const [groupName, setGroupName] = useState('');
  const [titleDraft, setTitleDraft] = useState('');
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [addingMembers, setAddingMembers] = useState(false);
  const [activeId, setActiveId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [typingByUser, setTypingByUser] = useState({});
  const [loadingInbox, setLoadingInbox] = useState(true);
  const [loadingThread, setLoadingThread] = useState(false);
  const [sending, setSending] = useState(false);
  const [aiThinkingId, setAiThinkingId] = useState(null);
  const [error, setError] = useState('');
  const [photoPerson, setPhotoPerson] = useState(null);
  const [menuMessageId, setMenuMessageId] = useState(null);
  const threadRef = useRef(null);
  const sendScale = useRef(new Animated.Value(1)).current;
  const typingRef = useRef(null);
  const activeIdRef = useRef(null);
  const inboxRef = useRef(inbox);
  inboxRef.current = inbox;
  activeIdRef.current = activeId;
  const onUnreadChangeRef = useRef(onUnreadChange);
  onUnreadChangeRef.current = onUnreadChange;
  const refreshInboxRef = useRef(async () => []);

  const activeThread = inbox.find((row) => row.conversationId === activeId) || null;

  const refreshInbox = useCallback(async () => {
    try {
      const [rows, people, teamRows] = await Promise.all([
        listDmInbox(),
        listDmContacts(),
        listTeams().catch(() => []),
      ]);
      setInbox(rows);
      setContacts(people);
      setTeams(teamRows);
      setError('');
      onUnreadChangeRef.current?.();
      return rows;
    } catch (err) {
      setError(err.message || 'Could not load messages.');
      return [];
    } finally {
      setLoadingInbox(false);
    }
  }, []);
  refreshInboxRef.current = refreshInbox;

  const openConversation = useCallback(
    async (conversationId, { skipLoad } = {}) => {
      if (!conversationId) return;
      setActiveId(conversationId);
      setComposeOpen(false);
      setSelectedIds([]);
      setGroupName('');
      setEmojiOpen(false);
      setDetailsOpen(false);
      setAddingMembers(false);
      setTypingByUser({});
      setMenuMessageId(null);
      setQuery('');
      setTitleDraft('');
      if (!skipLoad) setLoadingThread(true);
      try {
        if (!inboxRef.current.some((row) => row.conversationId === conversationId)) {
          try {
            await unhideDmConversation(conversationId);
            await refreshInboxRef.current();
          } catch {
            // Opening still works if this database has no conversation-hide function yet.
          }
        }
        const rows = await listDmMessages(conversationId, myId);
        setMessages(rows);
        await markDmRead(conversationId);
        setInbox((current) =>
          current.map((row) =>
            row.conversationId === conversationId ? { ...row, unreadCount: 0 } : row,
          ),
        );
        onUnreadChangeRef.current?.();
      } catch (err) {
        setError(err.message || 'Could not open that conversation.');
      } finally {
        setLoadingThread(false);
      }
    },
    [myId],
  );

  const startConversation = useCallback(async () => {
    if (selectedIds.length === 0) return;
    try {
      const conversationId =
        selectedIds.length === 1
          ? await getOrCreateDm(selectedIds[0])
          : await createDmGroup(selectedIds, groupName);
      await refreshInbox();
      await openConversation(conversationId);
    } catch (err) {
      setError(err.message || 'Could not start that chat.');
    }
  }, [selectedIds, groupName, openConversation, refreshInbox]);

  const openDirect = useCallback(
    async (personId) => {
      if (!personId) return;
      try {
        const conversationId = await getOrCreateDm(personId);
        await refreshInbox();
        await openConversation(conversationId);
      } catch (err) {
        setError(err.message || 'Could not start that chat.');
      }
    },
    [openConversation, refreshInbox],
  );

  const handleOpenProfile = (person) => {
    if (!person) return;
    if (onOpenProfile) {
      onOpenProfile(person);
      return;
    }
    setPhotoPerson(person);
  };

  const openedUserRef = useRef('');
  useEffect(() => {
    if (!openUserId) {
      openedUserRef.current = '';
      return;
    }
    if (openedUserRef.current === openUserId) return;
    openedUserRef.current = openUserId;
    void openDirect(openUserId).finally(() => onOpenedUser?.());
  }, [openUserId, openDirect, onOpenedUser]);

  const openTeam = useCallback(
    async (teamId) => {
      if (!teamId) return;
      try {
        const conversationId = await getOrCreateTeamDm(teamId);
        await refreshInbox();
        await openConversation(conversationId);
      } catch (err) {
        setError(err.message || 'Could not start that team chat.');
      }
    },
    [openConversation, refreshInbox],
  );

  useEffect(() => {
    refreshInbox();
  }, [refreshInbox]);

  useEffect(() => {
    const unsubscribe = subscribeDmRealtime({
      onMessage: (payload) => {
        const row = payload.new || payload.old;
        const conversationId = row?.conversation_id;
        if (payload.eventType === 'INSERT' && row?.id) {
          if (conversationId === activeIdRef.current) {
            setMessages((current) => {
              if (current.some((item) => item.id === row.id)) return current;
              const incoming = {
                id: row.id,
                conversationId: row.conversation_id,
                senderId: row.sender_id,
                body: row.body,
                createdAt: row.created_at,
                likedByMe: false,
                likeCount: 0,
              };
              const tempIndex = current.findIndex(
                (item) =>
                  item.localKey &&
                  String(item.id).startsWith('temp-') &&
                  item.body === row.body &&
                  item.senderId === row.sender_id,
              );
              if (tempIndex >= 0) {
                const next = current.slice();
                next[tempIndex] = {
                  ...incoming,
                  localKey: current[tempIndex].localKey,
                  justSent: current[tempIndex].justSent,
                };
                return next;
              }
              return [...current, incoming];
            });
            markDmRead(conversationId)
              .then(() => onUnreadChangeRef.current?.())
              .catch(() => {});
          }
        }
        if (payload.eventType === 'DELETE' && row?.id && conversationId === activeIdRef.current) {
          setMessages((current) => current.filter((item) => item.id !== row.id));
        }
        refreshInbox();
      },
      onHide: (payload) => {
        const messageId = payload.new?.message_id || payload.old?.message_id;
        const userId = payload.new?.user_id || payload.old?.user_id;
        if (!messageId || userId !== myId) return;
        if (payload.eventType === 'INSERT') {
          setMessages((current) => current.filter((item) => item.id !== messageId));
          setMenuMessageId((current) => (current === messageId ? null : current));
        }
        refreshInbox();
      },
      onLike: (payload) => {
        const messageId = payload.new?.message_id || payload.old?.message_id;
        const userId = payload.new?.user_id || payload.old?.user_id;
        if (!messageId) return;
        setMessages((current) =>
          current.map((item) => {
            if (item.id !== messageId) return item;
            if (payload.eventType === 'INSERT') {
              const already = userId === myId && item.likedByMe;
              return {
                ...item,
                likedByMe: userId === myId ? true : item.likedByMe,
                likeCount: already ? item.likeCount : item.likeCount + 1,
              };
            }
            if (payload.eventType === 'DELETE') {
              const already = userId === myId && !item.likedByMe;
              return {
                ...item,
                likedByMe: userId === myId ? false : item.likedByMe,
                likeCount: already ? item.likeCount : Math.max(0, item.likeCount - 1),
              };
            }
            return item;
          }),
        );
      },
      onPresence: () => {
        refreshInbox();
      },
      onConversation: () => {
        refreshInbox();
      },
      onParticipant: () => {
        refreshInbox();
      },
    });
    return unsubscribe;
  }, [myId, refreshInbox]);

  useEffect(() => {
    typingRef.current?.unsubscribe?.();
    typingRef.current = null;
    setTypingByUser({});
    if (!activeId || !myId) return undefined;
    typingRef.current = subscribeDmTyping(activeId, myId, (payload) => {
      setTypingByUser((current) => {
        const next = { ...current };
        if (payload.typing) next[payload.userId] = payload.name || 'Someone';
        else delete next[payload.userId];
        return next;
      });
    });
    return () => {
      typingRef.current?.unsubscribe?.();
      typingRef.current = null;
    };
  }, [activeId, myId]);

  useEffect(() => {
    if (!threadRef.current) return;
    requestAnimationFrame(() => {
      threadRef.current?.scrollToEnd?.({ animated: false });
    });
  }, [messages.length, typingByUser, activeId, aiThinkingId]);

  const peopleIndex = useMemo(() => {
    const byId = new Map(contacts.map((person) => [person.id, person]));
    inbox.forEach((row) => {
      (row.members || []).forEach((person) => {
        if (person?.id) byId.set(person.id, { ...person, ...(byId.get(person.id) || {}) });
      });
      if (row.other?.id) byId.set(row.other.id, { ...row.other, ...(byId.get(row.other.id) || {}) });
    });
    return Array.from(byId.values()).sort((a, b) =>
      contactName(a).localeCompare(contactName(b), undefined, { sensitivity: 'base' }),
    );
  }, [contacts, inbox]);

  const peopleById = useMemo(() => {
    const byId = new Map(peopleIndex.map((person) => [person.id, person]));
    return byId;
  }, [peopleIndex]);

  const selectedPeople = useMemo(
    () => selectedIds.map((id) => peopleById.get(id)).filter(Boolean),
    [selectedIds, peopleById],
  );

  const filteredInbox = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || composeOpen) return inbox;
    return inbox.filter((row) => {
      const hay = `${conversationTitle(row)} ${(row.members || []).map(contactName).join(' ')} ${row.lastMessagePreview}`.toLowerCase();
      return hay.includes(q);
    });
  }, [composeOpen, inbox, query]);

  const filteredPeople = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return peopleIndex;
    return peopleIndex.filter((person) => {
      const hay = `${contactName(person)} ${person.locationName || ''} ${person.teamName || ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [peopleIndex, query]);

  const filteredTeams = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return teams;
    return teams.filter((team) => {
      const hay = `${team.name} ${team.description} ${intakeNames(team)}`.toLowerCase();
      return hay.includes(q);
    });
  }, [teams, query]);

  const onlinePeople = useMemo(
    () => peopleIndex.filter((person) => person.isOnline && person.id !== myId),
    [peopleIndex, myId],
  );

  useEffect(() => {
    if (!menuMessageId || Platform.OS !== 'web' || typeof window === 'undefined') return undefined;
    const close = () => setMenuMessageId(null);
    const timer = setTimeout(() => window.addEventListener('click', close), 0);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('click', close);
    };
  }, [menuMessageId]);

  const handleToggleLike = async (message) => {
    if (!message?.id || String(message.id).startsWith('temp-')) return;
    let wasLiked = null;
    setMessages((current) =>
      current.map((item) => {
        if (item.id !== message.id) return item;
        wasLiked = item.likedByMe;
        return {
          ...item,
          likedByMe: !item.likedByMe,
          likeCount: item.likedByMe ? Math.max(0, item.likeCount - 1) : item.likeCount + 1,
        };
      }),
    );
    if (wasLiked == null) return;
    try {
      await toggleDmLike(message.id, wasLiked);
    } catch (err) {
      setError(err.message || 'Could not like that message.');
      refreshInbox();
      if (activeId) openConversation(activeId, { skipLoad: true });
    }
  };

  const handleDeleteForMe = async (message) => {
    if (!message?.id) return;
    setMenuMessageId(null);
    setMessages((current) => current.filter((item) => item.id !== message.id));
    if (String(message.id).startsWith('temp-')) return;
    try {
      await hideDmMessage(message.id);
      await refreshInbox();
    } catch (err) {
      setError(err.message || 'Could not delete that message.');
      if (activeId) openConversation(activeId, { skipLoad: true });
    }
  };

  const handleDeleteConversation = async (thread) => {
    const conversationId = thread?.conversationId;
    if (!conversationId) return;
    setMenuMessageId(null);
    setDetailsOpen(false);
    if (activeId === conversationId) {
      setActiveId(null);
      setMessages([]);
    }
    setInbox((current) => current.filter((row) => row.conversationId !== conversationId));
    try {
      await hideDmConversation(conversationId);
      await refreshInbox();
    } catch (err) {
      setError(err.message || 'Could not delete that chat.');
      await refreshInbox();
    }
  };

  const ensureAiSession = (conversationId) => {
    const existing = aiSessionsRef.current.get(conversationId);
    if (existing) return existing;
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - 6);
    const prepared = prepareAiChatSession({ startDate: start, endDate: end });
    aiSessionsRef.current.set(conversationId, prepared);
    return prepared;
  };

  const handleSend = async () => {
    const text = draft.trim();
    if (!text || !activeId || sending) return;
    const localKey = `local-${Date.now()}`;
    const tempId = `temp-${localKey}`;
    sendScale.setValue(0.82);
    Animated.spring(sendScale, {
      toValue: 1,
      friction: 5,
      tension: 180,
      useNativeDriver: true,
    }).start();
    if (activeThread?.isAi) {
      setDraft('');
      setEmojiOpen(false);
      setSending(true);
      setAiThinkingId(activeId);
      const history = messages
        .filter((item) => item.body && !String(item.id).startsWith('temp-'))
        .map((item) => ({
          role: item.isAssistant ? 'assistant' : 'user',
          content: item.body,
        }));
      setMessages((current) => [
        ...current,
        {
          id: tempId,
          localKey,
          justSent: true,
          conversationId: activeId,
          senderId: myId,
          body: text,
          createdAt: new Date().toISOString(),
          likedByMe: false,
          likeCount: 0,
          isAssistant: false,
          pending: true,
        },
      ]);
      try {
        const saved = await sendDmMessage(activeId, text);
        setMessages((current) => mergeSentMessage(current, localKey, tempId, saved));
        const prepared = ensureAiSession(activeId);
        const result = await sendAiChatMessage({
          seedMessages: prepared.seedMessages,
          turns: history,
          userMessage: text,
          model: AI_MODEL,
          session,
          context: prepared.context,
          startDate: prepared.context?.selection?.startDate,
          endDate: prepared.context?.selection?.endDate,
        });
        if (result.sources?.length) {
          prepared.context = { ...prepared.context, lastSources: result.sources };
        }
        const reply = await sendDmMessage(activeId, result.text || 'I could not answer that.', {
          assistant: true,
        });
        setMessages((current) => (
          current.some((item) => item.id === reply.id) ? current : [...current, reply]
        ));
        setAiThinkingId(null);
        await refreshInbox();
      } catch (err) {
        setAiThinkingId(null);
        setMessages((current) => current.filter((item) => item.id !== tempId));
        setDraft(text);
        setError(err.message || 'Could not get an answer.');
      } finally {
        setSending(false);
      }
      return;
    }
    setDraft('');
    setEmojiOpen(false);
    typingRef.current?.stop?.(myName);
    setSending(true);
    setMessages((current) => [
      ...current,
      {
        id: tempId,
        localKey,
        justSent: true,
        conversationId: activeId,
        senderId: myId,
        body: text,
        createdAt: new Date().toISOString(),
        likedByMe: false,
        likeCount: 0,
        pending: true,
      },
    ]);
    try {
      const saved = await sendDmMessage(activeId, text);
      setMessages((current) => mergeSentMessage(current, localKey, tempId, saved));
      await refreshInbox();
    } catch (err) {
      setMessages((current) => current.filter((item) => item.id !== tempId));
      setDraft(text);
      setError(err.message || 'Could not send that message.');
    } finally {
      setSending(false);
    }
  };

  const onChangeDraft = (value) => {
    setDraft(value);
    if (value.trim()) typingRef.current?.pulse?.(myName);
    else typingRef.current?.stop?.(myName);
  };

  const toggleSelected = (personId) => {
    setSelectedIds((current) =>
      current.includes(personId)
        ? current.filter((id) => id !== personId)
        : [...current, personId],
    );
  };

  const aiThinking = Boolean(activeThread?.isAi && aiThinkingId && aiThinkingId === activeId);
  const typingNames = Object.values(typingByUser).filter(Boolean);
  const typingLabel =
    typingNames.length === 0
      ? ''
      : typingNames.length === 1
        ? `${typingNames[0]} is typing…`
        : typingNames.length === 2
          ? `${typingNames[0]} and ${typingNames[1]} are typing…`
          : 'Several people are typing…';

  const showInbox = !isMobile || !activeId;
  const showThread = !isMobile || Boolean(activeId);

  const openAiConversation = useCallback(async () => {
    try {
      const conversationId = await getOrCreateAiDm();
      await refreshInbox();
      await openConversation(conversationId);
    } catch (err) {
      setError(err.message || 'Could not open MyCanadaGold AI.');
    }
  }, [openConversation, refreshInbox]);

  const threadLive = Boolean(activeId && activeThread);
  const memberIds = new Set((activeThread?.members || []).map((person) => person.id));
  const addablePeople = peopleIndex.filter((person) => !memberIds.has(person.id));

  const renderInboxList = () => {
    if (composeOpen) {
      const aiQuery = query.trim().toLowerCase();
      const showAiPin = !aiQuery || 'talk to ai mycanadagold'.includes(aiQuery);
      const aiPin = showAiPin ? (
        <Pressable
          key="talk-to-ai"
          onPress={() => void openAiConversation()}
          {...(Platform.OS === 'web' ? { className: 'cgold-dm-row' } : null)}
          style={({ pressed }) => [
            styles.personRow,
            isMobile && styles.personRowCompact,
            pressed && styles.rowPressed,
          ]}
          accessibilityLabel="Talk to AI"
        >
          <View
            style={[
              styles.avatar,
              styles.teamAvatar,
              styles.aiPinAvatar,
              isMobile && styles.teamAvatarCompact,
            ]}
          >
            <Ionicons name="sparkles" size={18} color="#fff" />
          </View>
          <View style={styles.personCopy}>
            <Text style={styles.personName} numberOfLines={1}>
              Talk to AI
            </Text>
            <Text style={styles.personSub} numberOfLines={1}>
              MyCanadaGold AI
            </Text>
          </View>
        </Pressable>
      ) : null;
      const teamRows = filteredTeams.map((team) => {
        const intake = intakeNames(team, 2);
        return (
          <Pressable
            key={`team-${team.id}`}
            onPress={() => openTeam(team.id)}
            {...(Platform.OS === 'web' ? { className: 'cgold-dm-row' } : null)}
            style={({ pressed }) => [
              styles.personRow,
              isMobile && styles.personRowCompact,
              pressed && styles.rowPressed,
            ]}
          >
            <View style={[styles.avatar, styles.teamAvatar, isMobile && styles.teamAvatarCompact]}>
              <Ionicons name="people" size={20} color="#fff" />
            </View>
            <View style={styles.personCopy}>
              <Text style={styles.personName} numberOfLines={1}>
                {team.name}
              </Text>
              <Text style={styles.personSub} numberOfLines={1}>
                {team.memberCount
                  ? `${team.memberCount} ${team.memberCount === 1 ? 'person' : 'people'}`
                  : 'No members yet'}
                {intake ? ` · Intake ${intake}` : ''}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color="#c7c7cc" />
          </Pressable>
        );
      });

      const peopleRows = filteredPeople.map((person) => {
        const checked = selectedIds.includes(person.id);
        return (
          <Pressable
            key={person.id}
            onPress={() => toggleSelected(person.id)}
            {...(Platform.OS === 'web' ? { className: 'cgold-dm-row' } : null)}
            style={({ pressed }) => [
              styles.personRow,
              isMobile && styles.personRowCompact,
              pressed && styles.rowPressed,
            ]}
          >
            <PersonAvatar person={person} size={isMobile ? 36 : 44} showOnline />
            <View style={styles.personCopy}>
              <Text style={styles.personName} numberOfLines={1}>
                {contactName(person)}
              </Text>
              <Text style={styles.personSub} numberOfLines={1}>
                {formatLastSeen(person.isOnline, person.lastSeenAt)}
                {person.teamName ? ` · ${person.teamName}` : person.locationName ? ` · ${person.locationName}` : ''}
                {person.isTeamIntake ? ' · Intake' : ''}
              </Text>
            </View>
            <Ionicons
              name={checked ? 'checkmark-circle' : 'ellipse-outline'}
              size={22}
              color={checked ? BLUE : '#c7c7cc'}
            />
          </Pressable>
        );
      });

      if (!aiPin && teamRows.length === 0 && peopleRows.length === 0) {
        return (
          <Text style={styles.emptyHint}>
            {peopleIndex.length === 0 && teams.length === 0
              ? 'No other staff have signed in yet, and no teams have been created.'
              : 'No matching people or teams.'}
          </Text>
        );
      }

      return (
        <>
          {aiPin}
          {teamRows.length > 0 ? (
            <>
              <Text style={styles.composeSection}>Teams</Text>
              {teamRows}
            </>
          ) : null}
          {peopleRows.length > 0 ? (
            <>
              <Text style={styles.composeSection}>People</Text>
              {peopleRows}
            </>
          ) : null}
        </>
      );
    }

    if (loadingInbox && inbox.length === 0) {
      return (
        <View style={styles.inboxCentered}>
          <ActivityIndicator color="#1d1d1f" />
        </View>
      );
    }

    if (filteredInbox.length === 0) {
      return (
        <View style={styles.inboxCentered}>
          <Ionicons name="chatbubbles-outline" size={36} color="#c7c7cc" />
          <Text style={styles.emptyTitle}>No messages yet</Text>
          <Text style={styles.emptyHint}>Tap the compose button to message a person or a team.</Text>
        </View>
      );
    }

    return filteredInbox.map((row) => {
      const selected = row.conversationId === activeId;
      const unread = row.unreadCount > 0;
      const senderName = row.lastMessageIsAssistant
        ? 'MyCanadaGold AI'
        : row.lastMessageSenderId === myId
          ? 'You'
          : firstNameOf((row.members || []).find((person) => person.id === row.lastMessageSenderId));
      const preview = row.lastMessagePreview
        ? row.isGroup || row.lastMessageSenderId === myId
          ? `${senderName}: ${row.lastMessagePreview}`
          : row.lastMessagePreview
        : row.isTeam
          ? 'New team chat'
          : row.isGroup
          ? 'New group chat'
          : 'Start the conversation';
      return (
        <View
          key={row.conversationId}
          {...(Platform.OS === 'web'
            ? { className: selected ? 'cgold-dm-row cgold-dm-row-active' : 'cgold-dm-row' }
            : null)}
          style={[styles.personRow, selected && styles.personRowSelected]}
        >
          <Pressable
            onPress={() => openConversation(row.conversationId)}
            onLongPress={() => confirmDeleteConversation(row, () => handleDeleteConversation(row))}
            style={({ pressed }) => [styles.rowOpen, pressed && styles.rowPressed]}
          >
            <ConversationAvatar conversation={row} size={52} />
            <View style={styles.personCopy}>
              <View style={styles.personTop}>
                <Text style={[styles.personName, unread && styles.personNameUnread]} numberOfLines={1}>
                  {conversationTitle(row)}
                </Text>
                <Text style={[styles.personTime, unread && styles.personTimeUnread]}>
                  {formatInboxTime(row.lastMessageAt)}
                </Text>
              </View>
              <View style={styles.personBottom}>
                <Text
                  style={[styles.personSub, unread && styles.personPreviewUnread]}
                  numberOfLines={1}
                >
                  {preview}
                </Text>
                {unread ? (
                  <View style={styles.unreadPill}>
                    <Text style={styles.unreadPillText}>
                      {row.unreadCount > 9 ? '9+' : row.unreadCount}
                    </Text>
                  </View>
                ) : null}
              </View>
            </View>
          </Pressable>
          <Pressable
            onPress={() => confirmDeleteConversation(row, () => handleDeleteConversation(row))}
            hitSlop={8}
            style={styles.rowDelete}
            accessibilityLabel={`Delete chat with ${conversationTitle(row)}`}
          >
            <Ionicons name="trash-outline" size={18} color="#8e8e93" />
          </Pressable>
        </View>
      );
    });
  };

  return (
    <KeyboardAvoidingView
      style={[styles.root, isMobile && styles.canvasMobile]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {showInbox ? (
        <View style={[styles.inbox, isMobile && styles.inboxMobile]}>
          <View style={[styles.inboxHeader, isMobile && styles.inboxHeaderMobile]}>
            <Text style={[styles.inboxTitle, isMobile && styles.inboxTitleMobile]} numberOfLines={1}>
              {composeOpen ? 'New' : 'Messages'}
            </Text>
            <View style={styles.inboxHeaderActions}>
              <Pressable
                onPress={() => {
                  setComposeOpen((current) => !current);
                  setSelectedIds([]);
                  setGroupName('');
                  setQuery('');
                  if (isMobile && !composeOpen) setActiveId(null);
                }}
                style={({ hovered, pressed }) => [
                  styles.composeButton,
                  (hovered || pressed) && styles.composeButtonHover,
                ]}
                accessibilityLabel={composeOpen ? 'Close compose' : 'Start a conversation'}
              >
                <Ionicons
                  name={composeOpen ? 'close' : 'create-outline'}
                  size={isMobile ? 22 : 18}
                  color={BLUE}
                />
              </Pressable>
            </View>
          </View>
          {composeOpen && selectedPeople.length > 0 ? (
            <View style={[styles.recipientBar, isMobile && styles.recipientBarMobile]}>
              <Text style={styles.recipientLabel}>To</Text>
              <View style={[styles.recipientBody, isMobile && styles.recipientBodyMobile]}>
                {selectedPeople.map((person) => (
                  <Pressable
                    key={person.id}
                    onPress={() => toggleSelected(person.id)}
                    style={({ hovered, pressed }) => [
                      styles.chip,
                      (hovered || pressed) && styles.chipHover,
                    ]}
                    accessibilityLabel={`Remove ${firstNameOf(person)}`}
                  >
                    <PersonAvatar person={person} size={20} />
                    <Text style={styles.chipText}>{firstNameOf(person)}</Text>
                    <Ionicons name="close" size={11} color={BLUE} />
                  </Pressable>
                ))}
                <Pressable
                  onPress={startConversation}
                  style={({ hovered, pressed }) => [
                    styles.createChatButton,
                    (hovered || pressed) && styles.createChatButtonHover,
                  ]}
                  accessibilityLabel={
                    selectedIds.length === 1
                      ? `Start chat with ${firstNameOf(selectedPeople[0])}`
                      : 'Create group chat'
                  }
                >
                  <Text style={styles.createChatButtonText} numberOfLines={1}>
                    {selectedIds.length === 1 ? 'Start chat' : 'Create group'}
                  </Text>
                  <Ionicons name="arrow-forward" size={13} color="#fff" />
                </Pressable>
              </View>
            </View>
          ) : null}
          {composeOpen && selectedIds.length >= 2 ? (
            <View style={styles.groupNameWrap}>
              <TextInput
                style={styles.groupNameInput}
                value={groupName}
                onChangeText={setGroupName}
                placeholder="Group name (optional)"
                placeholderTextColor="#8e8e93"
                maxLength={80}
              />
            </View>
          ) : null}
          {isMobile && !composeOpen && onlinePeople.length > 0 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.storiesScroll}
              contentContainerStyle={styles.storiesRow}
            >
              {onlinePeople.map((person) => (
                <Pressable
                  key={person.id}
                  onPress={() => openDirect(person.id)}
                  style={styles.storyItem}
                  accessibilityLabel={`Message ${firstNameOf(person)}`}
                >
                  <View style={styles.storyRing}>
                    <PersonAvatar person={person} size={56} showOnline />
                  </View>
                  <Text style={styles.storyName} numberOfLines={1}>
                    {firstNameOf(person)}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          ) : null}
          <View style={styles.searchWrap}>
            <Ionicons name="search" size={15} color="#8e8e93" />
            <TextInput
              style={styles.searchInput}
              value={query}
              onChangeText={setQuery}
              placeholder={composeOpen ? 'Search people or teams' : 'Search'}
              placeholderTextColor="#8e8e93"
              autoCapitalize="none"
              autoCorrect={false}
            />
            {query ? (
              <Pressable onPress={() => setQuery('')} hitSlop={8}>
                <Ionicons name="close-circle" size={16} color="#c7c7cc" />
              </Pressable>
            ) : null}
          </View>
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
          <ScrollView
            style={styles.inboxList}
            contentContainerStyle={styles.inboxListContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {renderInboxList()}
          </ScrollView>
        </View>
      ) : null}

      {showThread ? (
        <View style={[styles.thread, isMobile && styles.canvasMobile]}>
          {threadLive ? (
            <>
              <View style={styles.threadHeader}>
                {isMobile ? (
                  <Pressable
                    onPress={() => {
                      setActiveId(null);
                      setEmojiOpen(false);
                      setDetailsOpen(false);
                      setAddingMembers(false);
                    }}
                    style={styles.backButton}
                    hitSlop={8}
                    accessibilityLabel="Back to messages"
                  >
                    <Ionicons name="chevron-back" size={22} color={BLUE} />
                  </Pressable>
                ) : null}
                <View style={styles.threadHeaderMain}>
                  <Pressable
                    onPress={() => {
                      if (activeThread.isGroup) {
                        setTitleDraft(activeThread.title || '');
                        setDetailsOpen(true);
                        setAddingMembers(false);
                        return;
                      }
                      if (activeThread.other) handleOpenProfile(activeThread.other);
                    }}
                    accessibilityLabel={
                      activeThread.isGroup
                        ? 'Group details'
                        : `View ${conversationTitle(activeThread)}'s profile`
                    }
                  >
                    <ConversationAvatar conversation={activeThread} size={36} />
                  </Pressable>
                  <Pressable
                    onPress={() => {
                      if (!activeThread.isGroup) return;
                      setTitleDraft(activeThread.title || '');
                      setDetailsOpen(true);
                      setAddingMembers(false);
                    }}
                    style={styles.threadHeaderCopy}
                  >
                    <Text style={styles.threadName} numberOfLines={1}>
                      {conversationTitle(activeThread)}
                    </Text>
                    <Text
                      style={[
                        styles.threadSeen,
                        !activeThread.isGroup && activeThread.other?.isOnline && styles.threadSeenLive,
                      ]}
                    >
                      {conversationSubtitle(activeThread, {
                        typingLabel: aiThinking ? 'Thinking…' : typingLabel,
                      })}
                    </Text>
                  </Pressable>
                </View>
                <Pressable
                  onPress={() =>
                    confirmDeleteConversation(activeThread, () => handleDeleteConversation(activeThread))
                  }
                  style={styles.infoButton}
                  accessibilityLabel="Delete chat"
                >
                  <Ionicons name="trash-outline" size={20} color="#8e8e93" />
                </Pressable>
                {activeThread.isGroup ? (
                  <Pressable
                    onPress={() => {
                      setDetailsOpen((current) => {
                        if (!current) setTitleDraft(activeThread.title || '');
                        return !current;
                      });
                      setAddingMembers(false);
                    }}
                    style={styles.infoButton}
                    accessibilityLabel="Group details"
                  >
                    <Ionicons
                      name={detailsOpen ? 'close-circle' : 'information-circle-outline'}
                      size={22}
                      color={BLUE}
                    />
                  </Pressable>
                ) : null}
              </View>

              {detailsOpen && activeThread.isGroup ? (
                <ScrollView
                  style={styles.detailsPanel}
                  contentContainerStyle={styles.detailsContent}
                  keyboardShouldPersistTaps="handled"
                >
                  {activeThread.isTeam ? (
                    <>
                      <Text style={styles.detailsLabel}>Team</Text>
                      <Text style={styles.detailsTeamName}>{conversationTitle(activeThread)}</Text>
                    </>
                  ) : (
                    <>
                      <Text style={styles.detailsLabel}>Group name</Text>
                      <TextInput
                        style={styles.detailsNameInput}
                        value={titleDraft}
                        onChangeText={setTitleDraft}
                        placeholder={conversationTitle(activeThread)}
                        placeholderTextColor="#8e8e93"
                        maxLength={80}
                        onSubmitEditing={async () => {
                          try {
                            await renameDmGroup(activeThread.conversationId, titleDraft);
                            await refreshInbox();
                          } catch (err) {
                            setError(err.message || 'Could not rename that group.');
                          }
                        }}
                        onEndEditing={async () => {
                          if (titleDraft === (activeThread.title || '')) return;
                          try {
                            await renameDmGroup(activeThread.conversationId, titleDraft);
                            await refreshInbox();
                          } catch (err) {
                            setError(err.message || 'Could not rename that group.');
                          }
                        }}
                      />
                    </>
                  )}
                  <Text style={styles.detailsLabel}>
                    {activeThread.members.length + 1} people
                  </Text>
                  {activeThread.members.map((person) => (
                    <Pressable
                      key={person.id}
                      onPress={() => handleOpenProfile(person)}
                      style={styles.detailsMember}
                      accessibilityLabel={`View ${contactName(person)}'s profile`}
                    >
                      <PersonAvatar person={person} size={36} showOnline />
                      <View style={styles.personCopy}>
                        <Text style={styles.personName} numberOfLines={1}>
                          {contactName(person)}
                        </Text>
                        <Text style={styles.personSub} numberOfLines={1}>
                          {person.isTeamIntake && person.teamId === activeThread.teamId ? 'Intake contact · ' : ''}
                          {formatLastSeen(person.isOnline, person.lastSeenAt)}
                        </Text>
                      </View>
                      {person.isTeamIntake && person.teamId === activeThread.teamId ? (
                        <View style={styles.intakeBadge}>
                          <Text style={styles.intakeBadgeText}>Intake</Text>
                        </View>
                      ) : null}
                    </Pressable>
                  ))}
                  {!activeThread.isTeam && !activeThread.isAi ? (
                    <>
                      <Pressable
                        onPress={() => setAddingMembers((current) => !current)}
                        style={styles.detailsAction}
                      >
                        <Ionicons name="person-add-outline" size={18} color={BLUE} />
                        <Text style={styles.detailsActionText}>Add people</Text>
                      </Pressable>
                      {addingMembers
                        ? addablePeople.map((person) => (
                            <Pressable
                              key={person.id}
                              onPress={async () => {
                                try {
                                  await addDmGroupMembers(activeThread.conversationId, [person.id]);
                                  await refreshInbox();
                                } catch (err) {
                                  setError(err.message || 'Could not add that person.');
                                }
                              }}
                              style={styles.detailsMember}
                            >
                              <PersonAvatar person={person} size={36} showOnline />
                              <Text style={styles.personName}>{contactName(person)}</Text>
                              <Ionicons name="add-circle-outline" size={20} color={BLUE} />
                            </Pressable>
                          ))
                        : null}
                    </>
                  ) : null}
                  <Pressable
                    onPress={() =>
                      confirmDeleteConversation(activeThread, () => handleDeleteConversation(activeThread))
                    }
                    style={styles.leaveButton}
                  >
                    <Text style={styles.leaveButtonText}>
                      {activeThread.isAi ? 'Delete chat' : 'Delete for you'}
                    </Text>
                  </Pressable>
                  {!activeThread.isAi ? (
                    <Pressable
                      onPress={async () => {
                        try {
                          const id = activeThread.conversationId;
                          await leaveDmGroup(id);
                          setActiveId(null);
                          setDetailsOpen(false);
                          await refreshInbox();
                        } catch (err) {
                          setError(err.message || 'Could not leave that group.');
                        }
                      }}
                      style={styles.leaveButton}
                    >
                      <Text style={styles.leaveButtonText}>
                        {activeThread.isTeam ? 'Leave team chat' : 'Leave group'}
                      </Text>
                    </Pressable>
                  ) : null}
                </ScrollView>
              ) : (
                <>
                  <ScrollView
                    ref={threadRef}
                    style={styles.threadList}
                    contentContainerStyle={styles.threadListContent}
                    keyboardShouldPersistTaps="handled"
                    onContentSizeChange={() => threadRef.current?.scrollToEnd?.({ animated: true })}
                  >
                    {loadingThread && messages.length === 0 ? (
                      <ActivityIndicator color="#1d1d1f" style={styles.threadSpinner} />
                    ) : messages.length === 0 ? (
                      <View style={[styles.threadEmpty, isMobile && styles.threadEmptyMobile]}>
                        <Pressable
                          onPress={() => {
                            if (!activeThread.isGroup && activeThread.other) {
                              handleOpenProfile(activeThread.other);
                            }
                          }}
                          accessibilityLabel={`View ${conversationTitle(activeThread)}'s profile`}
                        >
                          <ConversationAvatar conversation={activeThread} size={isMobile ? 52 : 72} />
                        </Pressable>
                        <Text style={styles.threadEmptyName}>{conversationTitle(activeThread)}</Text>
                        <Text style={styles.emptyHint}>
                          {conversationSubtitle(activeThread)}
                        </Text>
                      </View>
                    ) : (
                      messages.map((message, index) => {
                        const prev = messages[index - 1];
                        const next = messages[index + 1];
                        const mine = !message.isAssistant && message.senderId === myId;
                        const sameAuthor = (left, right) =>
                          Boolean(left?.isAssistant) === Boolean(right?.isAssistant) &&
                          left?.senderId === right?.senderId;
                        const groupedWithPrev = sameAuthor(prev, message) && !shouldShowStamp(prev, message);
                        const groupedWithNext = sameAuthor(message, next) && !shouldShowStamp(message, next);
                        const sender = peopleById.get(message.senderId);
                        return (
                          <View key={message.localKey || message.id} style={groupedWithPrev ? styles.msgTight : styles.msgGap}>
                            {shouldShowStamp(prev, message) ? (
                              <Text style={styles.stamp}>{formatThreadStamp(message.createdAt)}</Text>
                            ) : null}
                            <MessageBubble
                              message={message}
                              mine={mine}
                              groupedWithPrev={groupedWithPrev}
                              groupedWithNext={groupedWithNext}
                              senderLabel={
                                message.isAssistant
                                  ? 'MyCanadaGold AI'
                                  : activeThread.isGroup && !mine
                                    ? firstNameOf(sender)
                                    : null
                              }
                              menuOpen={menuMessageId === message.id}
                              onOpenMenu={(item) => setMenuMessageId(item.id)}
                              onCloseMenu={() => setMenuMessageId(null)}
                              onToggleLike={handleToggleLike}
                              onDeleteForMe={handleDeleteForMe}
                              onSendSettled={(item) => {
                                setMessages((current) =>
                                  current.map((row) =>
                                    row.localKey && row.localKey === item.localKey
                                      ? { ...row, justSent: false }
                                      : row,
                                  ),
                                );
                              }}
                            />
                          </View>
                        );
                      })
                    )}
                    {aiThinking ? (
                      <View style={styles.msgGap}>
                        <Text style={styles.senderLabel}>MyCanadaGold AI</Text>
                        <View style={styles.typingRow}>
                          <TypingDots />
                        </View>
                      </View>
                    ) : typingNames.length > 0 ? (
                      <View style={styles.typingRow}>
                        <TypingDots />
                      </View>
                    ) : null}
                  </ScrollView>

                  <EmojiPicker
                    visible={emojiOpen}
                    onPick={(emoji) => {
                      setDraft((current) => `${current}${emoji}`);
                      typingRef.current?.pulse?.(myName);
                    }}
                  />

                  <View style={[styles.composer, isMobile && styles.composerMobile]}>
                    <Pressable
                      onPress={() => setEmojiOpen((current) => !current)}
                      style={({ hovered, pressed }) => [
                        styles.emojiToggle,
                        (hovered || pressed || emojiOpen) && styles.emojiToggleActive,
                      ]}
                      accessibilityLabel="Emojis"
                    >
                      <Ionicons
                        name={emojiOpen ? 'happy' : 'happy-outline'}
                        size={isMobile ? 22 : 26}
                        color={emojiOpen ? BLUE : '#8e8e93'}
                      />
                    </Pressable>
                    <View style={[styles.composerField, isMobile && styles.composerFieldMobile]}>
                      <TextInput
                        style={[styles.composerInput, isMobile && styles.composerInputMobile]}
                        value={draft}
                        onChangeText={onChangeDraft}
                        placeholder={activeThread?.isAi ? 'Message MyCanadaGold AI' : 'Message'}
                        placeholderTextColor="#8e8e93"
                        multiline={false}
                        numberOfLines={1}
                        returnKeyType="send"
                        maxLength={4000}
                        blurOnSubmit={false}
                        onSubmitEditing={Platform.OS === 'web' ? undefined : handleSend}
                        {...(Platform.OS === 'web'
                          ? {
                              onKeyDown: (event) => {
                                if (event.key === 'Enter') {
                                  event.preventDefault();
                                  handleSend();
                                }
                              },
                            }
                          : null)}
                      />
                    </View>
                    <Animated.View style={{ transform: [{ scale: sendScale }] }}>
                      <Pressable
                        onPress={handleSend}
                        disabled={!draft.trim() || sending}
                        style={[
                          styles.sendButton,
                          draft.trim() ? styles.sendButtonOn : styles.sendButtonOff,
                        ]}
                        accessibilityLabel="Send"
                      >
                        <Ionicons name="arrow-up" size={18} color="#fff" />
                      </Pressable>
                    </Animated.View>
                  </View>
                </>
              )}
            </>
          ) : (
            <View style={styles.threadPlaceholder}>
              <View style={styles.placeholderIcon}>
                <Ionicons name="chatbubbles-outline" size={36} color={BLUE} />
              </View>
              <Text style={styles.emptyTitle}>Direct Messages</Text>
              <Text style={styles.emptyHint}>
                Pick a conversation, or message a person or a team.
              </Text>
            </View>
          )}
        </View>
      ) : null}
      <ProfilePhotoModal
        visible={Boolean(photoPerson)}
        onClose={() => setPhotoPerson(null)}
        profileId={photoPerson?.id || ''}
        name={contactName(photoPerson)}
        avatarUrl={photoPerson?.avatarUrl || ''}
        locationName={photoPerson?.locationName || ''}
        myId={myId}
        myName={myName}
        myAvatarUrl={session?.profile?.avatarUrl || ''}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    minHeight: 0,
    height: '100%',
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e5e5ea',
  },
  inbox: {
    width: INBOX_WIDTH,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: '#e5e5ea',
    backgroundColor: '#fff',
    minHeight: 0,
  },
  inboxMobile: {
    width: '100%',
    borderRightWidth: 0,
    flex: 1,
    backgroundColor: CANVAS,
  },
  canvasMobile: {
    backgroundColor: CANVAS,
  },
  inboxHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 18,
    paddingBottom: 8,
  },
  inboxHeaderMobile: {
    paddingTop: 8,
  },
  storiesScroll: {
    flexGrow: 0,
    flexShrink: 0,
    height: 96,
    maxHeight: 96,
  },
  storiesRow: {
    paddingHorizontal: 14,
    paddingVertical: 4,
    gap: 14,
    flexDirection: 'row',
    alignItems: 'flex-start',
    flexGrow: 0,
  },
  storyItem: {
    width: 68,
    alignItems: 'center',
    gap: 6,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  storyRing: {
    padding: 2,
    borderRadius: 34,
    borderWidth: 2,
    borderColor: '#E8C36A',
  },
  storyName: {
    fontFamily,
    fontSize: 11,
    fontWeight: '500',
    color: '#1d1d1f',
    width: '100%',
    textAlign: 'center',
  },
  inboxTitle: {
    fontFamily,
    fontSize: 28,
    fontWeight: '700',
    color: '#1d1d1f',
    letterSpacing: -0.6,
    flex: 1,
    minWidth: 0,
  },
  inboxTitleMobile: {
    fontSize: 22,
    letterSpacing: -0.4,
  },
  inboxHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  recipientBar: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginHorizontal: 12,
    marginBottom: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    backgroundColor: '#f2f2f7',
    flexGrow: 0,
    flexShrink: 0,
  },
  recipientLabel: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: '#8e8e93',
    lineHeight: 24,
  },
  recipientBarMobile: {
    alignItems: 'center',
    minHeight: 40,
    maxHeight: 44,
    paddingVertical: 4,
  },
  recipientBody: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
  },
  recipientBodyMobile: {
    flexWrap: 'nowrap',
    overflow: 'hidden',
  },
  createChatButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: BLUE,
    alignSelf: 'flex-start',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  createChatButtonHover: {
    backgroundColor: '#0077ed',
  },
  createChatButtonText: {
    fontFamily,
    fontSize: 12,
    fontWeight: '700',
    color: '#fff',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#fff',
    borderRadius: 999,
    paddingLeft: 2,
    paddingRight: 8,
    paddingVertical: 2,
    alignSelf: 'flex-start',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  chipHover: {
    backgroundColor: '#eef4ff',
  },
  chipText: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: BLUE,
  },
  groupNameWrap: {
    marginHorizontal: 12,
    marginBottom: 8,
    backgroundColor: '#f2f2f7',
    borderRadius: 10,
    paddingHorizontal: 10,
    height: 36,
    justifyContent: 'center',
  },
  groupNameInput: {
    fontFamily,
    fontSize: 15,
    color: '#1d1d1f',
    padding: 0,
    outlineStyle: 'none',
  },
  composeButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#eef4ff',
  },
  composeButtonHover: {
    backgroundColor: '#dceaff',
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 12,
    marginBottom: 8,
    paddingHorizontal: 10,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#f2f2f7',
  },
  searchInput: {
    flex: 1,
    fontFamily,
    fontSize: 15,
    color: '#1d1d1f',
    paddingVertical: 0,
    outlineStyle: 'none',
  },
  errorText: {
    fontFamily,
    fontSize: 12,
    color: '#b91c1c',
    paddingHorizontal: 16,
    paddingBottom: 6,
  },
  inboxList: {
    flex: 1,
    minHeight: 0,
  },
  inboxListContent: {
    paddingBottom: 24,
  },
  composeSection: {
    fontFamily,
    fontSize: 12,
    fontWeight: '700',
    color: '#8e8e93',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 4,
  },
  aiPinAvatar: {
    backgroundColor: '#6B4DE6',
  },
  teamAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: BLUE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  teamAvatarCompact: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  inboxCentered: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    paddingTop: 64,
    gap: 8,
  },
  personRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  personRowCompact: {
    gap: 10,
    paddingVertical: 6,
  },
  personRowSelected: {
    backgroundColor: '#ececef',
  },
  rowPressed: {
    backgroundColor: '#f5f5f7',
  },
  rowOpen: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  rowDelete: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  personCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  personTop: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
  },
  personBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  personName: {
    flex: 1,
    fontFamily,
    fontSize: 16,
    color: '#1d1d1f',
    fontWeight: '500',
  },
  personNameUnread: {
    fontWeight: '700',
  },
  personTime: {
    fontFamily,
    fontSize: 12,
    color: '#8e8e93',
  },
  personTimeUnread: {
    color: BLUE,
    fontWeight: '600',
  },
  personSub: {
    flex: 1,
    fontFamily,
    fontSize: 14,
    color: '#8e8e93',
  },
  personPreviewUnread: {
    color: '#1d1d1f',
    fontWeight: '600',
  },
  unreadPill: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: BLUE,
  },
  unreadPillText: {
    fontFamily,
    fontSize: 11,
    fontWeight: '700',
    color: '#fff',
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
  onlineDot: {
    position: 'absolute',
    backgroundColor: '#34C759',
    borderWidth: 2,
    borderColor: '#fff',
  },
  thread: {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    backgroundColor: '#fff',
  },
  threadHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e5ea',
  },
  threadHeaderMain: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  infoButton: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backButton: {
    width: 28,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  threadHeaderCopy: {
    flex: 1,
    minWidth: 0,
  },
  threadName: {
    fontFamily,
    fontSize: 16,
    fontWeight: '600',
    color: '#1d1d1f',
  },
  threadSeen: {
    fontFamily,
    fontSize: 12,
    color: '#8e8e93',
    marginTop: 1,
  },
  threadSeenLive: {
    color: '#34C759',
  },
  threadList: {
    flex: 1,
    minHeight: 0,
  },
  threadListContent: {
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 10,
  },
  threadSpinner: {
    marginTop: 48,
  },
  threadEmpty: {
    alignItems: 'center',
    paddingTop: 72,
    gap: 8,
  },
  threadEmptyMobile: {
    paddingTop: 24,
    gap: 4,
  },
  threadEmptyName: {
    fontFamily,
    fontSize: 20,
    fontWeight: '600',
    color: '#1d1d1f',
    marginTop: 8,
  },
  threadPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 8,
  },
  placeholderIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#eef4ff',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  emptyTitle: {
    fontFamily,
    fontSize: 20,
    fontWeight: '600',
    color: '#1d1d1f',
    textAlign: 'center',
  },
  emptyHint: {
    fontFamily,
    fontSize: 14,
    color: '#8e8e93',
    textAlign: 'center',
    lineHeight: 20,
  },
  stamp: {
    fontFamily,
    fontSize: 11,
    color: '#8e8e93',
    textAlign: 'center',
    marginBottom: 8,
    marginTop: 6,
  },
  msgGap: {
    marginTop: 10,
  },
  msgTight: {
    marginTop: 2,
  },
  bubbleRow: {
    maxWidth: '78%',
    position: 'relative',
  },
  bubbleRowMine: {
    alignSelf: 'flex-end',
  },
  bubbleRowTheirs: {
    alignSelf: 'flex-start',
  },
  senderLabel: {
    fontFamily,
    fontSize: 11,
    color: '#8e8e93',
    marginBottom: 3,
    marginLeft: 4,
  },
  detailsPanel: {
    flex: 1,
    minHeight: 0,
    backgroundColor: '#fff',
  },
  detailsContent: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 32,
  },
  detailsLabel: {
    fontFamily,
    fontSize: 12,
    fontWeight: '600',
    color: '#8e8e93',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 8,
    marginTop: 12,
  },
  detailsNameInput: {
    fontFamily,
    fontSize: 17,
    fontWeight: '600',
    color: '#1d1d1f',
    backgroundColor: '#f2f2f7',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    outlineStyle: 'none',
  },
  detailsTeamName: {
    fontFamily,
    fontSize: 17,
    fontWeight: '600',
    color: '#1d1d1f',
    marginBottom: 4,
  },
  intakeBadge: {
    backgroundColor: '#eef4ff',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  intakeBadgeText: {
    fontFamily,
    fontSize: 11,
    fontWeight: '700',
    color: BLUE,
  },
  detailsMember: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
  },
  detailsAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
  },
  detailsActionText: {
    fontFamily,
    fontSize: 16,
    fontWeight: '600',
    color: BLUE,
  },
  leaveButton: {
    marginTop: 24,
    alignItems: 'center',
    paddingVertical: 12,
  },
  leaveButtonText: {
    fontFamily,
    fontSize: 16,
    fontWeight: '600',
    color: '#ff3b30',
  },
  bubbleRowLiked: {
    marginBottom: 12,
  },
  bubbleStack: {
    alignItems: 'flex-start',
  },
  bubbleStackMine: {
    alignItems: 'flex-end',
  },
  bubbleLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  bubbleLineMine: {
    flexDirection: 'row-reverse',
  },
  bubbleMore: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  bubbleMoreHover: {
    backgroundColor: '#f2f2f7',
  },
  msgMenu: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
    backgroundColor: '#1d1d1f',
    borderRadius: 12,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.22,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  msgMenuMine: {
    alignSelf: 'flex-end',
  },
  msgMenuTheirs: {
    alignSelf: 'flex-start',
  },
  msgMenuItem: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  msgMenuItemHover: {
    backgroundColor: '#2c2c2e',
  },
  msgMenuDivider: {
    width: StyleSheet.hairlineWidth,
    alignSelf: 'stretch',
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  msgMenuText: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: '#fff',
  },
  msgMenuDanger: {
    color: '#ff453a',
  },
  bubble: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    maxWidth: '100%',
  },
  bubbleMine: {
    backgroundColor: BLUE,
  },
  bubbleTheirs: {
    backgroundColor: '#e9e9eb',
  },
  bubbleHoverMine: {
    backgroundColor: '#0077ed',
  },
  bubbleHoverTheirs: {
    backgroundColor: '#dedee2',
  },
  bubbleText: {
    fontFamily,
    fontSize: 16,
    lineHeight: 22,
    color: '#1d1d1f',
  },
  bubbleTextMine: {
    color: '#fff',
  },
  heartBurst: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 4,
    textAlign: 'center',
    fontSize: 34,
  },
  likeBadge: {
    position: 'absolute',
    bottom: -10,
    backgroundColor: '#fff',
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e5ea',
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
  },
  likeBadgeMine: {
    left: -6,
  },
  likeBadgeTheirs: {
    right: -6,
  },
  likeBadgeText: {
    fontFamily,
    fontSize: 11,
  },
  typingRow: {
    alignSelf: 'flex-start',
    marginTop: 8,
  },
  typingBubble: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#e9e9eb',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  typingDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#8e8e93',
  },
  emojiPanel: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e5e5ea',
    height: 220,
    backgroundColor: '#fafafa',
  },
  emojiTabs: {
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 4,
  },
  emojiTab: {
    width: 36,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emojiTabActive: {
    backgroundColor: '#ececef',
  },
  emojiTabLabel: {
    fontSize: 18,
  },
  emojiGrid: {
    flex: 1,
  },
  emojiGridInner: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 8,
    paddingBottom: 12,
  },
  emojiCell: {
    width: '10%',
    minWidth: 36,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
  },
  emojiCellHover: {
    backgroundColor: '#ececef',
  },
  emojiGlyph: {
    fontSize: 22,
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: Platform.OS === 'web' ? 12 : 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e5e5ea',
    backgroundColor: '#fff',
  },
  emojiToggle: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emojiToggleActive: {
    opacity: 0.85,
  },
  composerField: {
    flex: 1,
    height: 36,
    minHeight: 36,
    maxHeight: 36,
    borderWidth: 1,
    borderColor: '#d1d1d6',
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 0,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  composerInput: {
    fontFamily,
    fontSize: 16,
    lineHeight: 20,
    height: 22,
    maxHeight: 22,
    color: '#1d1d1f',
    padding: 0,
    paddingVertical: 0,
    margin: 0,
    outlineStyle: 'none',
  },
  sendButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonOn: {
    backgroundColor: BLUE,
  },
  sendButtonOff: {
    backgroundColor: '#c7c7cc',
  },
  composerMobile: {
    paddingTop: 6,
    paddingBottom: 8,
    alignItems: 'center',
  },
  composerFieldMobile: {
    height: 34,
    minHeight: 34,
    maxHeight: 34,
    paddingVertical: 0,
  },
  composerInputMobile: {
    fontSize: 16,
    lineHeight: 20,
    height: 20,
    maxHeight: 20,
  },
  aiComposerField: {
    height: 36,
    minHeight: 36,
    maxHeight: 36,
    paddingVertical: 0,
    justifyContent: 'center',
  },
  aiComposerInput: {
    height: 22,
    maxHeight: 22,
    fontSize: 16,
    lineHeight: 20,
    paddingVertical: 0,
  },
  startConvoButton: {
    height: 36,
    paddingHorizontal: 14,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: BLUE,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  startConvoButtonOff: {
    opacity: 0.4,
  },
  startConvoButtonPressed: {
    opacity: 0.8,
  },
  startConvoButtonText: {
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
    letterSpacing: -0.2,
  },
  aiLaunch: {
    height: 36,
    paddingHorizontal: 12,
    borderRadius: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#f2f2f7',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  aiLaunchPressed: {
    backgroundColor: '#e5e5ea',
  },
  aiLaunchActive: {
    backgroundColor: '#e8f1ff',
  },
  aiLaunchText: {
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: '#1d1d1f',
    letterSpacing: -0.2,
  },
  aiLaunchTextActive: {
    color: BLUE,
  },
  aiPanel: {
    flex: 1,
    minHeight: 0,
    backgroundColor: '#fff',
  },
  aiHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e5ea',
  },
  aiBack: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  aiHeaderCopy: {
    flex: 1,
    minWidth: 0,
  },
  aiTitle: {
    fontFamily,
    fontSize: 17,
    fontWeight: '600',
    color: '#1d1d1f',
  },
  aiSubtitle: {
    fontFamily,
    fontSize: 12,
    color: '#8e8e93',
  },
  aiList: {
    flex: 1,
    minHeight: 0,
  },
  aiListContent: {
    paddingHorizontal: 14,
    paddingTop: 16,
    paddingBottom: 12,
    gap: 8,
  },
  aiEmpty: {
    alignItems: 'center',
    paddingTop: 28,
    gap: 6,
  },
  aiEmptyTitle: {
    fontFamily,
    fontSize: 17,
    fontWeight: '600',
    color: '#1d1d1f',
  },
  aiBubble: {
    maxWidth: '84%',
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  aiBubbleMine: {
    alignSelf: 'flex-end',
    backgroundColor: BLUE,
  },
  aiBubbleThem: {
    alignSelf: 'flex-start',
    backgroundColor: '#f2f2f7',
  },
  aiBubbleText: {
    fontFamily,
    fontSize: 16,
    lineHeight: 21,
    color: '#1d1d1f',
  },
  aiBubbleTextMine: {
    color: '#fff',
  },
  aiBusy: {
    alignSelf: 'flex-start',
    marginTop: 4,
  },
});
