import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
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
  getOrCreateDm,
  initialsFromName,
  leaveDmGroup,
  listDmContacts,
  listDmInbox,
  listDmMessages,
  markDmRead,
  renameDmGroup,
  sendDmMessage,
  shouldShowStamp,
  subscribeDmRealtime,
  subscribeDmTyping,
  toggleDmLike,
} from '../lib/messages';

const fontFamily = Platform.select({
  ios: 'Sohne',
  android: 'Sohne',
  default: 'Sohne',
});

const BLUE = '#0A84FF';
const INBOX_WIDTH = 340;
const MOBILE_BREAKPOINT = 768;

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

function MessageBubble({
  message,
  mine,
  groupedWithPrev,
  groupedWithNext,
  senderLabel,
  onToggleLike,
}) {
  const lastTap = useRef(0);
  const [burst, setBurst] = useState(0);
  const radius = 18;
  const cluster = {
    borderTopLeftRadius: !mine && groupedWithPrev ? 6 : radius,
    borderBottomLeftRadius: !mine && groupedWithNext ? 6 : radius,
    borderTopRightRadius: mine && groupedWithPrev ? 6 : radius,
    borderBottomRightRadius: mine && groupedWithNext ? 6 : radius,
  };

  const handlePress = () => {
    const now = Date.now();
    if (now - lastTap.current < 320) {
      if (!message.likedByMe) setBurst((current) => current + 1);
      onToggleLike(message);
    }
    lastTap.current = now;
  };

  return (
    <View style={[styles.bubbleRow, mine ? styles.bubbleRowMine : styles.bubbleRowTheirs, message.likeCount > 0 && styles.bubbleRowLiked]}>
      {senderLabel && !groupedWithPrev ? (
        <Text style={styles.senderLabel} numberOfLines={1}>
          {senderLabel}
        </Text>
      ) : null}
      <Pressable
        onPress={handlePress}
        onLongPress={() => onToggleLike(message)}
        delayLongPress={280}
        style={({ hovered }) => [
          styles.bubble,
          mine ? styles.bubbleMine : styles.bubbleTheirs,
          cluster,
          hovered && !mine && styles.bubbleHoverTheirs,
          hovered && mine && styles.bubbleHoverMine,
        ]}
      >
        <Text style={[styles.bubbleText, mine && styles.bubbleTextMine]}>{message.body}</Text>
        <HeartBurst trigger={burst} />
      </Pressable>
      {message.likeCount > 0 ? (
        <View style={[styles.likeBadge, mine ? styles.likeBadgeMine : styles.likeBadgeTheirs]}>
          <Text style={styles.likeBadgeText}>
            ❤️{message.likeCount > 1 ? ` ${message.likeCount}` : ''}
          </Text>
        </View>
      ) : null}
    </View>
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

export default function MessagesScreen({ session }) {
  const isMobile = useIsMobile();
  const myId = session?.supabaseUserId || session?.profile?.id || '';
  const myName =
    session?.profile?.fullName ||
    [session?.profile?.firstName, session?.profile?.lastName].filter(Boolean).join(' ') ||
    'You';
  const [inbox, setInbox] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [query, setQuery] = useState('');
  const [composeOpen, setComposeOpen] = useState(false);
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
  const [error, setError] = useState('');
  const threadRef = useRef(null);
  const typingRef = useRef(null);
  const activeIdRef = useRef(null);
  const inboxRef = useRef(inbox);
  inboxRef.current = inbox;
  activeIdRef.current = activeId;

  const activeThread = inbox.find((row) => row.conversationId === activeId) || null;

  const refreshInbox = useCallback(async () => {
    try {
      const [rows, people] = await Promise.all([listDmInbox(), listDmContacts()]);
      setInbox(rows);
      setContacts(people);
      setError('');
      return rows;
    } catch (err) {
      setError(err.message || 'Could not load messages.');
      return [];
    } finally {
      setLoadingInbox(false);
    }
  }, []);

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
      setQuery('');
      setTitleDraft('');
      if (!skipLoad) setLoadingThread(true);
      try {
        const rows = await listDmMessages(conversationId, myId);
        setMessages(rows);
        await markDmRead(conversationId);
        setInbox((current) =>
          current.map((row) =>
            row.conversationId === conversationId ? { ...row, unreadCount: 0 } : row,
          ),
        );
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
              return [
                ...current,
                {
                  id: row.id,
                  conversationId: row.conversation_id,
                  senderId: row.sender_id,
                  body: row.body,
                  createdAt: row.created_at,
                  likedByMe: false,
                  likeCount: 0,
                },
              ];
            });
            markDmRead(conversationId).catch(() => {});
          }
        }
        if (payload.eventType === 'DELETE' && row?.id && conversationId === activeIdRef.current) {
          setMessages((current) => current.filter((item) => item.id !== row.id));
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
  }, [messages.length, typingByUser, activeId]);

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
      const hay = `${contactName(person)} ${person.locationName || ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [peopleIndex, query]);

  const handleToggleLike = async (message) => {
    if (!message?.id || String(message.id).startsWith('temp-')) return;
    setMessages((current) =>
      current.map((item) =>
        item.id === message.id
          ? {
              ...item,
              likedByMe: !item.likedByMe,
              likeCount: item.likedByMe ? Math.max(0, item.likeCount - 1) : item.likeCount + 1,
            }
          : item,
      ),
    );
    try {
      await toggleDmLike(message.id, message.likedByMe);
    } catch (err) {
      setError(err.message || 'Could not like that message.');
      refreshInbox();
      if (activeId) openConversation(activeId, { skipLoad: true });
    }
  };

  const handleSend = async () => {
    const text = draft.trim();
    if (!text || !activeId || sending) return;
    setDraft('');
    setEmojiOpen(false);
    typingRef.current?.stop?.(myName);
    setSending(true);
    const tempId = `temp-${Date.now()}`;
    setMessages((current) => [
      ...current,
      {
        id: tempId,
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
      setMessages((current) => {
        const withoutTemp = current.filter((item) => item.id !== tempId);
        if (withoutTemp.some((item) => item.id === saved.id)) return withoutTemp;
        return [...withoutTemp, saved];
      });
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
  const threadLive = Boolean(activeId && activeThread);
  const memberIds = new Set((activeThread?.members || []).map((person) => person.id));
  const addablePeople = peopleIndex.filter((person) => !memberIds.has(person.id));

  const renderInboxList = () => {
    if (composeOpen) {
      if (filteredPeople.length === 0) {
        return (
          <Text style={styles.emptyHint}>
            {peopleIndex.length === 0
              ? 'No other staff have signed in yet.'
              : 'No matching people.'}
          </Text>
        );
      }
      return filteredPeople.map((person) => {
        const checked = selectedIds.includes(person.id);
        return (
          <Pressable
            key={person.id}
            onPress={() => toggleSelected(person.id)}
            {...(Platform.OS === 'web' ? { className: 'cgold-dm-row' } : null)}
            style={({ pressed }) => [styles.personRow, pressed && styles.rowPressed]}
          >
            <PersonAvatar person={person} size={44} showOnline />
            <View style={styles.personCopy}>
              <Text style={styles.personName} numberOfLines={1}>
                {contactName(person)}
              </Text>
              <Text style={styles.personSub} numberOfLines={1}>
                {formatLastSeen(person.isOnline, person.lastSeenAt)}
                {person.locationName ? ` · ${person.locationName}` : ''}
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
          <Text style={styles.emptyHint}>Tap the compose button to message a teammate or start a group.</Text>
        </View>
      );
    }

    return filteredInbox.map((row) => {
      const selected = row.conversationId === activeId;
      const unread = row.unreadCount > 0;
      const senderName =
        row.lastMessageSenderId === myId
          ? 'You'
          : firstNameOf((row.members || []).find((person) => person.id === row.lastMessageSenderId));
      const preview = row.lastMessagePreview
        ? row.isGroup || row.lastMessageSenderId === myId
          ? `${senderName}: ${row.lastMessagePreview}`
          : row.lastMessagePreview
        : row.isGroup
          ? 'New group chat'
          : 'Start the conversation';
      return (
        <Pressable
          key={row.conversationId}
          onPress={() => openConversation(row.conversationId)}
          {...(Platform.OS === 'web'
            ? { className: selected ? 'cgold-dm-row cgold-dm-row-active' : 'cgold-dm-row' }
            : null)}
          style={({ pressed }) => [
            styles.personRow,
            selected && styles.personRowSelected,
            pressed && styles.rowPressed,
          ]}
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
      );
    });
  };

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {showInbox ? (
        <View style={[styles.inbox, isMobile && styles.inboxMobile]}>
          <View style={styles.inboxHeader}>
            <Text style={styles.inboxTitle}>{composeOpen ? 'New message' : 'Messages'}</Text>
            <View style={styles.inboxHeaderActions}>
              {composeOpen && selectedIds.length > 0 ? (
                <Pressable
                  onPress={startConversation}
                  style={({ hovered, pressed }) => [
                    styles.createChatButton,
                    (hovered || pressed) && styles.createChatButtonHover,
                  ]}
                >
                  <Text style={styles.createChatButtonText}>
                    {selectedIds.length === 1 ? 'Chat' : 'Create'}
                  </Text>
                </Pressable>
              ) : null}
              <Pressable
                onPress={() => {
                  setComposeOpen((current) => !current);
                  setSelectedIds([]);
                  setGroupName('');
                  setQuery('');
                  if (isMobile) setActiveId(null);
                }}
                style={({ hovered, pressed }) => [
                  styles.composeButton,
                  (hovered || pressed) && styles.composeButtonHover,
                ]}
                accessibilityLabel={composeOpen ? 'Close compose' : 'New message'}
              >
                <Ionicons
                  name={composeOpen ? 'close' : 'create-outline'}
                  size={18}
                  color={BLUE}
                />
              </Pressable>
            </View>
          </View>
          {composeOpen && selectedPeople.length > 0 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chipRow}
            >
              {selectedPeople.map((person) => (
                <Pressable
                  key={person.id}
                  onPress={() => toggleSelected(person.id)}
                  style={styles.chip}
                >
                  <Text style={styles.chipText}>{firstNameOf(person)}</Text>
                  <Ionicons name="close" size={12} color={BLUE} />
                </Pressable>
              ))}
            </ScrollView>
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
          <View style={styles.searchWrap}>
            <Ionicons name="search" size={15} color="#8e8e93" />
            <TextInput
              style={styles.searchInput}
              value={query}
              onChangeText={setQuery}
              placeholder={composeOpen ? 'Search people' : 'Search'}
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
        <View style={styles.thread}>
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
                <Pressable
                  onPress={() => {
                    if (!activeThread.isGroup) return;
                    setTitleDraft(activeThread.title || '');
                    setDetailsOpen(true);
                    setAddingMembers(false);
                  }}
                  style={styles.threadHeaderMain}
                >
                  <ConversationAvatar conversation={activeThread} size={36} />
                  <View style={styles.threadHeaderCopy}>
                    <Text style={styles.threadName} numberOfLines={1}>
                      {conversationTitle(activeThread)}
                    </Text>
                    <Text
                      style={[
                        styles.threadSeen,
                        !activeThread.isGroup && activeThread.other?.isOnline && styles.threadSeenLive,
                      ]}
                    >
                      {conversationSubtitle(activeThread, { typingLabel })}
                    </Text>
                  </View>
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
                  <Text style={styles.detailsLabel}>
                    {activeThread.members.length + 1} people
                  </Text>
                  {activeThread.members.map((person) => (
                    <View key={person.id} style={styles.detailsMember}>
                      <PersonAvatar person={person} size={36} showOnline />
                      <View style={styles.personCopy}>
                        <Text style={styles.personName} numberOfLines={1}>
                          {contactName(person)}
                        </Text>
                        <Text style={styles.personSub} numberOfLines={1}>
                          {formatLastSeen(person.isOnline, person.lastSeenAt)}
                        </Text>
                      </View>
                    </View>
                  ))}
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
                    <Text style={styles.leaveButtonText}>Leave group</Text>
                  </Pressable>
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
                      <View style={styles.threadEmpty}>
                        <ConversationAvatar conversation={activeThread} size={72} />
                        <Text style={styles.threadEmptyName}>{conversationTitle(activeThread)}</Text>
                        <Text style={styles.emptyHint}>
                          {conversationSubtitle(activeThread)}
                        </Text>
                      </View>
                    ) : (
                      messages.map((message, index) => {
                        const prev = messages[index - 1];
                        const next = messages[index + 1];
                        const mine = message.senderId === myId;
                        const groupedWithPrev =
                          prev?.senderId === message.senderId && !shouldShowStamp(prev, message);
                        const groupedWithNext =
                          next?.senderId === message.senderId && !shouldShowStamp(message, next);
                        const sender = peopleById.get(message.senderId);
                        return (
                          <View key={message.id} style={groupedWithPrev ? styles.msgTight : styles.msgGap}>
                            {shouldShowStamp(prev, message) ? (
                              <Text style={styles.stamp}>{formatThreadStamp(message.createdAt)}</Text>
                            ) : null}
                            <MessageBubble
                              message={message}
                              mine={mine}
                              groupedWithPrev={groupedWithPrev}
                              groupedWithNext={groupedWithNext}
                              senderLabel={
                                activeThread.isGroup && !mine ? firstNameOf(sender) : null
                              }
                              onToggleLike={handleToggleLike}
                            />
                          </View>
                        );
                      })
                    )}
                    {typingNames.length > 0 ? (
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

                  <View style={styles.composer}>
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
                        size={26}
                        color={emojiOpen ? BLUE : '#8e8e93'}
                      />
                    </Pressable>
                    <View style={styles.composerField}>
                      <TextInput
                        style={styles.composerInput}
                        value={draft}
                        onChangeText={onChangeDraft}
                        placeholder="Message"
                        placeholderTextColor="#8e8e93"
                        multiline
                        maxLength={4000}
                        blurOnSubmit={false}
                        onSubmitEditing={Platform.OS === 'web' ? undefined : handleSend}
                        {...(Platform.OS === 'web'
                          ? {
                              onKeyDown: (event) => {
                                if (event.key === 'Enter' && !event.shiftKey) {
                                  event.preventDefault();
                                  handleSend();
                                }
                              },
                            }
                          : null)}
                      />
                    </View>
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
                Pick a conversation, or start a group with people on the team.
              </Text>
            </View>
          )}
        </View>
      ) : null}
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
  },
  inboxHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 18,
    paddingBottom: 8,
  },
  inboxTitle: {
    fontFamily,
    fontSize: 28,
    fontWeight: '700',
    color: '#1d1d1f',
    letterSpacing: -0.6,
    flex: 1,
  },
  inboxHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  createChatButton: {
    paddingHorizontal: 12,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: BLUE,
  },
  createChatButtonHover: {
    backgroundColor: '#0077ed',
  },
  createChatButtonText: {
    fontFamily,
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
  },
  chipRow: {
    paddingHorizontal: 12,
    paddingBottom: 8,
    gap: 8,
    flexDirection: 'row',
    alignItems: 'center',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#eef4ff',
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 5,
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
  personRowSelected: {
    backgroundColor: '#ececef',
  },
  rowPressed: {
    backgroundColor: '#f5f5f7',
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
    alignItems: 'flex-end',
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
    marginBottom: 2,
  },
  emojiToggleActive: {
    opacity: 0.85,
  },
  composerField: {
    flex: 1,
    minHeight: 36,
    maxHeight: 120,
    borderWidth: 1,
    borderColor: '#d1d1d6',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === 'web' ? 7 : 6,
    justifyContent: 'center',
  },
  composerInput: {
    fontFamily,
    fontSize: 16,
    color: '#1d1d1f',
    maxHeight: 100,
    padding: 0,
    outlineStyle: 'none',
  },
  sendButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 3,
  },
  sendButtonOn: {
    backgroundColor: BLUE,
  },
  sendButtonOff: {
    backgroundColor: '#c7c7cc',
  },
});
