import { createElement, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BlurView } from 'expo-blur';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Image,
  KeyboardAvoidingView,
  Modal,
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
  hideDmConversation,
  hideDmMessage,
  initialsFromName,
  isDefaultAiTitle,
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
  unhideDmConversation,
} from '../lib/messages';
import {
  AGENT_CONVERSATION_TITLE,
  agentReceivedCopy,
  createAgentRequest,
  emptyAgentThread,
  forwardAgentRequest,
  groupAgentConversations,
  listAgentRequests,
  newAgentConversationId,
} from '../lib/agentRequests';
import { fetchAureusEmployee } from '../lib/aureusEmployees';
import { prepareAiChatSession, sendAiChatMessage, titleAiChat } from '../lib/aiChat';
import { OPENROUTER_MODELS } from '../lib/openrouter';
import { mobileTabBarReserve, useMobileTabBarScrollProps } from '../lib/mobileTabBar';
import { CANVAS, mobileSafeBottom } from '../lib/mobileUi';
import { listStaffProfiles, useAppAccess } from '../lib/permissions';
import ProfilePhotoModal from './ProfilePhotoModal';
import { usePhoneCalls } from './PhoneCallProvider';

const fontFamily = Platform.select({
  ios: 'Sohne',
  android: 'Sohne',
  default: 'Sohne',
});


const BLUE = '#0A84FF';
const AI_PURPLE = '#6B4DE6';
const AGENT_TEAL = '#0F766E';
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

const AI_MENTION_RE = /(^|[\s([{<"'“‘])(@ai)\b/gi;

function mentionsAi(text) {
  AI_MENTION_RE.lastIndex = 0;
  return AI_MENTION_RE.test(String(text || ''));
}

function formatDmThreadForAi({ messages, peopleById, myId, myName, thread }) {
  const title = conversationTitle(thread);
  const lines = (messages || [])
    .slice(-40)
    .map((item) => {
      const body = String(item.body || '').replace(/\s+/g, ' ').trim().slice(0, 400);
      if (!body) return '';
      const name = item.isAssistant
        ? 'MyCanadaGold AI'
        : item.senderId === myId
          ? myName || 'You'
          : contactName(peopleById?.get?.(item.senderId)) || 'Teammate';
      return `${name}: ${body}`;
    })
    .filter(Boolean);
  return [
    'You are MyCanadaGold AI answering inside a staff Direct Message. Everyone in this chat can see your reply.',
    `Thread: ${title}`,
    'Use this conversation as context and answer the latest @AI request. Be concise and specific.',
    lines.length ? `Recent messages:\n${lines.join('\n')}` : 'No earlier messages.',
  ].join('\n\n');
}

function MessageBody({ body, mine }) {
  const source = String(body || '');
  const textStyle = [styles.bubbleText, mine && styles.bubbleTextMine];
  const mentionStyle = mine ? styles.aiMentionOnMine : styles.aiMention;
  const nodes = [];
  const re = /(^|[\s([{<"'“‘])(@ai)\b/gi;
  let last = 0;
  let key = 0;
  let match = re.exec(source);
  while (match) {
    const start = match.index + match[1].length;
    const end = start + match[2].length;
    if (start > last) nodes.push(source.slice(last, start));
    nodes.push(
      <Text key={`ai-${key++}`} style={mentionStyle}>
        {source.slice(start, end)}
      </Text>,
    );
    last = end;
    match = re.exec(source);
  }
  if (!key) return <Text style={textStyle}>{source}</Text>;
  if (last < source.length) nodes.push(source.slice(last));
  return <Text style={textStyle}>{nodes}</Text>;
}

function firstNameOf(person) {
  const first = String(person?.firstName || '').trim();
  if (first) return first;
  return contactName(person).split(/\s+/)[0] || 'Teammate';
}

function ComposeIcon({ size = 24, color = '#1d1d1f' }) {
  if (Platform.OS === 'web') {
    return createElement(
      'svg',
      {
        width: size,
        height: size,
        viewBox: '0 0 24 24',
        fill: 'none',
        'aria-hidden': true,
      },
      createElement('path', {
        d: 'M12.2 3.2H5.25A3 3 0 0 0 2.25 6.2v12.55a3 3 0 0 0 3 3h12.55a3 3 0 0 0 3-3V11.8',
        stroke: color,
        strokeWidth: 2,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      }),
      createElement('path', {
        d: 'M10 17.23H6.77v-3.23L18.61 2.17a1.42 1.42 0 0 1 2 0l1.23 1.22a1.42 1.42 0 0 1 0 2.01z',
        stroke: color,
        strokeWidth: 2,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      }),
      createElement('path', {
        d: 'M10 13 18.83 4.17',
        stroke: color,
        strokeWidth: 2,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      }),
    );
  }
  return <Ionicons name="create-outline" size={size} color={color} />;
}

function ConversationAvatar({ conversation, size = 52 }) {
  if (conversation?.isAgent) {
    return (
      <View
        style={[
          styles.avatar,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: AGENT_TEAL,
          },
        ]}
      >
        <Ionicons name="construct" size={Math.max(16, Math.round(size * 0.42))} color="#fff" />
      </View>
    );
  }
  if (conversation?.isAi) {
    return (
      <View
        style={[
          styles.avatar,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: AI_PURPLE,
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

function deliveryLabel(state) {
  if (state === 'sending') return 'Sending';
  if (state === 'sent') return 'Sent';
  if (state === 'received') return 'Received';
  return '';
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
  actionsDisabled = false,
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
  const showMore = !actionsDisabled && Platform.OS === 'web' && (hovered || menuOpen);
  const status = mine && !groupedWithNext ? deliveryLabel(message.deliveryState) : '';

  const handlePress = () => {
    if (actionsDisabled) return;
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
    if (actionsDisabled) return;
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
            <MessageBody body={message.body} mine={mine} />
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
      {status ? <Text style={styles.deliveryState}>{status}</Text> : null}
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

export default function MessagesScreen({
  session,
  onUnreadChange,
  openUserId,
  onOpenedUser,
  onOpenProfile,
  onConversationOpenChange,
}) {
  const isMobile = useIsMobile();
  const tabBarScroll = useMobileTabBarScrollProps();
  const phone = usePhoneCalls();
  const { hasApp } = useAppAccess();
  const canPhone = hasApp('phone');
  const myId = session?.supabaseUserId || session?.profile?.id || '';
  const myName =
    session?.profile?.fullName ||
    [session?.profile?.firstName, session?.profile?.lastName].filter(Boolean).join(' ') ||
    'You';
  const [inbox, setInbox] = useState([]);
  const [agentInbox, setAgentInbox] = useState([]);
  const [agentMessages, setAgentMessages] = useState({});
  const [contacts, setContacts] = useState([]);
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
  const [menuConversation, setMenuConversation] = useState(null);
  const [menuMessageId, setMenuMessageId] = useState(null);
  const threadRef = useRef(null);
  const sendScale = useRef(new Animated.Value(1)).current;
  const draftRef = useRef('');
  const sendingRef = useRef(false);
  const typingRef = useRef(null);
  const activeIdRef = useRef(null);
  const titledAiRef = useRef(new Set());
  const inboxRef = useRef(inbox);
  const agentInboxRef = useRef(agentInbox);
  const agentMessagesRef = useRef(agentMessages);
  inboxRef.current = inbox;
  agentInboxRef.current = agentInbox;
  agentMessagesRef.current = agentMessages;
  activeIdRef.current = activeId;
  draftRef.current = draft;
  const onUnreadChangeRef = useRef(onUnreadChange);
  onUnreadChangeRef.current = onUnreadChange;
  const onConversationOpenChangeRef = useRef(onConversationOpenChange);
  onConversationOpenChangeRef.current = onConversationOpenChange;
  const refreshInboxRef = useRef(async () => []);

  useEffect(() => {
    onConversationOpenChangeRef.current?.(Boolean(isMobile && activeId));
  }, [isMobile, activeId]);

  useEffect(() => {
    return () => onConversationOpenChangeRef.current?.(false);
  }, []);

  const mergedInbox = useMemo(() => {
    const seen = new Set();
    const rows = [];
    agentInbox.forEach((row) => {
      if (!row?.conversationId || seen.has(row.conversationId)) return;
      seen.add(row.conversationId);
      rows.push(row);
    });
    inbox.forEach((row) => {
      if (!row?.conversationId || seen.has(row.conversationId) || row.isAgent) return;
      seen.add(row.conversationId);
      rows.push(row);
    });
    rows.sort((left, right) => {
      const a = left.lastMessageAt ? new Date(left.lastMessageAt).getTime() : left.isAgent ? Date.now() : 0;
      const b = right.lastMessageAt ? new Date(right.lastMessageAt).getTime() : right.isAgent ? Date.now() : 0;
      return b - a;
    });
    return rows;
  }, [agentInbox, inbox]);

  const activeThread = mergedInbox.find((row) => row.conversationId === activeId) || null;

  const refreshInbox = useCallback(async () => {
    if (!session?.token) {
      setLoadingInbox(false);
      return [];
    }
    try {
      const [rows, people] = await Promise.all([
        listDmInbox(),
        listDmContacts(),
      ]);
      setInbox(rows);
      setContacts(people);
      setError('');
      onUnreadChangeRef.current?.();
      return rows;
    } catch (err) {
      setError(err.message || 'Could not load messages.');
      return [];
    } finally {
      setLoadingInbox(false);
    }
  }, [session?.token]);
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
      const agentThread = agentInboxRef.current.find((row) => row.conversationId === conversationId);
      if (agentThread) {
        setMessages(agentMessagesRef.current[conversationId] || []);
        setLoadingThread(false);
        return;
      }
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

  const handleCallThread = async () => {
    if (activeThread?.isAi || activeThread?.isAgent || activeThread?.isGroup) {
      setError('Call a person from their profile.');
      return;
    }
    if (!canPhone) {
      setError('You don’t have access to Phone.');
      return;
    }
    const person = activeThread?.other;
    if (!person?.id) {
      setError('No one to call in this chat.');
      return;
    }
    try {
      const staff = (await listStaffProfiles()).find((row) => row.id === person.id);
      const employeeId = staff?.aureusUserId;
      let number = '';
      if (session?.token && employeeId) {
        const { mapped } = await fetchAureusEmployee(session.token, employeeId, session.baseUrl);
        number = mapped?.phone || '';
      }
      if (!number) {
        setError('No phone number on file.');
        return;
      }
      await phone.ringOut(number);
    } catch (err) {
      setError(err.message || 'Could not start the call.');
    }
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

  useEffect(() => {
    if (!myId || !session?.token) {
      setLoadingInbox(false);
      return;
    }
    refreshInbox();
  }, [myId, refreshInbox, session?.token]);

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
                isAssistant: Boolean(row.is_assistant),
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
    if (!q || composeOpen) return mergedInbox;
    return mergedInbox.filter((row) => {
      const hay = `${conversationTitle(row)} ${(row.members || []).map(contactName).join(' ')} ${row.lastMessagePreview}`.toLowerCase();
      return hay.includes(q);
    });
  }, [composeOpen, mergedInbox, query]);

  const filteredPeople = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return peopleIndex;
    return peopleIndex.filter((person) => {
      const hay = `${contactName(person)} ${person.locationName || ''} ${person.teamName || ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [peopleIndex, query]);

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
    if (thread?.isAgent) {
      setAgentInbox((current) => current.filter((row) => row.conversationId !== conversationId));
      setAgentMessages((current) => {
        const next = { ...current };
        delete next[conversationId];
        return next;
      });
      return;
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
    if (!text || !activeId || sending || sendingRef.current) return;
    sendingRef.current = true;
    const localKey = `local-${Date.now()}`;
    const tempId = `temp-${localKey}`;
    sendScale.setValue(0.82);
    Animated.spring(sendScale, {
      toValue: 1,
      friction: 5,
      tension: 180,
      useNativeDriver: true,
    }).start();
    if (activeThread?.isAgent) {
      const conversationId = activeId;
      setDraft('');
      setEmojiOpen(false);
      setSending(true);
      setMessages((current) => [
        ...current,
        {
          id: tempId,
          localKey,
          justSent: true,
          conversationId,
          senderId: myId,
          body: text,
          createdAt: new Date().toISOString(),
          likedByMe: false,
          likeCount: 0,
          isAssistant: false,
          deliveryState: 'sending',
          pending: true,
        },
      ]);
      try {
        const saved = await createAgentRequest({
          conversationId,
          body: text,
          senderId: myId,
        });
        const sentAt = saved.createdAt || new Date().toISOString();
        const sentMessage = {
          id: saved.id,
          localKey,
          justSent: true,
          conversationId,
          senderId: saved.senderId || myId,
          body: saved.body || text,
          createdAt: sentAt,
          likedByMe: false,
          likeCount: 0,
          isAssistant: false,
          deliveryState: 'sent',
          requestStatus: saved.status,
        };
        setMessages((current) => mergeSentMessage(current, localKey, tempId, sentMessage));
        await forwardAgentRequest(saved);
        const receivedMessage = { ...sentMessage, deliveryState: 'received' };
        const ack = {
          id: `${saved.id}-ack`,
          conversationId,
          senderId: null,
          body: agentReceivedCopy(saved.status),
          createdAt: saved.updatedAt || sentAt,
          likedByMe: false,
          likeCount: 0,
          isAssistant: true,
          isAgentAck: true,
          deliveryState: 'received',
          requestStatus: saved.status,
        };
        setMessages((current) => {
          const next = mergeSentMessage(current, localKey, tempId, receivedMessage);
          if (next.some((item) => item.id === ack.id)) return next;
          return [...next, ack];
        });
        setAgentMessages((current) => {
          const existing = (current[conversationId] || []).filter(
            (item) => item.id !== tempId && item.localKey !== localKey && item.id !== saved.id && item.id !== ack.id,
          );
          return {
            ...current,
            [conversationId]: [...existing, receivedMessage, ack],
          };
        });
        setAgentInbox((current) =>
          current.map((row) =>
            row.conversationId === conversationId
              ? {
                  ...row,
                  title: row.title || AGENT_CONVERSATION_TITLE,
                  lastMessagePreview: saved.body || text,
                  lastMessageAt: sentAt,
                  lastMessageSenderId: saved.senderId || myId,
                }
              : row,
          ),
        );
      } catch (err) {
        setMessages((current) => current.filter((item) => item.id !== tempId));
        setDraft(text);
        setError(err.message || 'Could not send that request.');
      } finally {
        sendingRef.current = false;
        setSending(false);
      }
      return;
    }
    if (activeThread?.isAi) {
      const conversationId = activeId;
      const threadTitle = activeThread.title;
      setDraft('');
      setEmojiOpen(false);
      setSending(true);
      setAiThinkingId(conversationId);
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
          conversationId,
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
        const saved = await sendDmMessage(conversationId, text);
        setMessages((current) => mergeSentMessage(current, localKey, tempId, saved));
        const prepared = ensureAiSession(conversationId);
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
        if (result.sources?.length || result.scope) {
          prepared.context = {
            ...prepared.context,
            lastSources: result.sources?.length ? result.sources : prepared.context.lastSources,
            lastScope: result.scope || prepared.context.lastScope,
          };
        }
        const reply = await sendDmMessage(conversationId, result.text || 'I could not answer that.', {
          assistant: true,
        });
        setMessages((current) => (
          current.some((item) => item.id === reply.id) ? current : [...current, reply]
        ));
        setAiThinkingId(null);
        await refreshInbox();
        if (isDefaultAiTitle(threadTitle) && !titledAiRef.current.has(conversationId)) {
          titledAiRef.current.add(conversationId);
          void titleAiChat(
            [
              ...history,
              { role: 'user', content: text },
              { role: 'assistant', content: result.text || '' },
            ],
            AI_MODEL,
          )
            .then(async (title) => {
              if (!title) return;
              await renameDmGroup(conversationId, title);
              await refreshInbox();
            })
            .catch(() => {
              titledAiRef.current.delete(conversationId);
            });
        }
      } catch (err) {
        setAiThinkingId(null);
        setMessages((current) => current.filter((item) => item.id !== tempId));
        setDraft(text);
        setError(err.message || 'Could not get an answer.');
      } finally {
        sendingRef.current = false;
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
      sendingRef.current = false;
      setSending(false);
      if (!mentionsAi(text)) return;
      const conversationId = activeId;
      const thread = activeThread;
      setAiThinkingId(conversationId);
      try {
        const prepared = ensureAiSession(conversationId);
        const prior = messages.filter((item) => item.body && !String(item.id).startsWith('temp-'));
        const result = await sendAiChatMessage({
          seedMessages: prepared.seedMessages,
          turns: [],
          userMessage: text,
          extraContext: formatDmThreadForAi({
            messages: [...prior, saved],
            peopleById,
            myId,
            myName,
            thread,
          }),
          model: AI_MODEL,
          session,
          context: prepared.context,
          startDate: prepared.context?.selection?.startDate,
          endDate: prepared.context?.selection?.endDate,
        });
        if (result.sources?.length || result.scope) {
          prepared.context = {
            ...prepared.context,
            lastSources: result.sources?.length ? result.sources : prepared.context.lastSources,
            lastScope: result.scope || prepared.context.lastScope,
          };
        }
        const reply = await sendDmMessage(conversationId, result.text || 'I could not answer that.', {
          assistant: true,
        });
        setMessages((current) => (
          current.some((item) => item.id === reply.id) ? current : [...current, reply]
        ));
        await refreshInbox();
      } catch (err) {
        setError(err.message || 'Could not get an AI answer.');
      } finally {
        setAiThinkingId(null);
      }
      return;
    } catch (err) {
      setMessages((current) => current.filter((item) => item.id !== tempId));
      setDraft(text);
      setError(err.message || 'Could not send that message.');
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };

  const submitFromKeyboard = (event) => {
    const key = event?.nativeEvent?.key || event?.key;
    if (key !== 'Enter') return;
    event?.preventDefault?.();
    void handleSend();
  };

  const onChangeDraft = (value) => {
    draftRef.current = value;
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

  const aiThinking = Boolean(aiThinkingId && aiThinkingId === activeId);
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

  const openAgentConversation = useCallback(() => {
    const conversationId = newAgentConversationId();
    const thread = emptyAgentThread(conversationId);
    setAgentInbox((current) => [thread, ...current.filter((row) => row.conversationId !== conversationId)]);
    setAgentMessages((current) => ({ ...current, [conversationId]: [] }));
    setComposeOpen(false);
    setSelectedIds([]);
    setGroupName('');
    setQuery('');
    setError('');
    setMessages([]);
    setActiveId(conversationId);
    setEmojiOpen(false);
    setDetailsOpen(false);
    setAddingMembers(false);
    setTypingByUser({});
    setMenuMessageId(null);
    setLoadingThread(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!myId || !session?.token) return undefined;
    (async () => {
      try {
        const rows = await listAgentRequests();
        if (cancelled) return;
        const grouped = groupAgentConversations(rows, myId);
        setAgentInbox((current) => {
          const persisted = new Set(grouped.inbox.map((row) => row.conversationId));
          const locals = current.filter((row) => row.isAgent && !persisted.has(row.conversationId));
          return [...grouped.inbox, ...locals];
        });
        setAgentMessages((current) => ({ ...grouped.messages, ...current }));
      } catch {
        // Table is not on the live project until this migration is applied.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [myId, session?.token]);

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
              Start a new conversation
            </Text>
          </View>
        </Pressable>
      ) : null;

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

      if (!aiPin && peopleRows.length === 0) {
        return (
          <Text style={styles.emptyHint}>
            {peopleIndex.length === 0
              ? 'No other staff have signed in yet.'
              : 'No matching people.'}
          </Text>
        );
      }

      return (
        <>
          {aiPin}
          {peopleRows.length > 0 ? (
            <>
              <Text style={styles.composeSection}>People</Text>
              {peopleRows}
            </>
          ) : null}
        </>
      );
    }

    if (loadingInbox && mergedInbox.length === 0) {
      return (
        <View style={[styles.inboxCentered, isMobile && styles.inboxCenteredMobile]}>
          <ActivityIndicator color="#1d1d1f" />
        </View>
      );
    }

    if (filteredInbox.length === 0) {
      return (
        <View style={[styles.inboxCentered, isMobile && styles.inboxCenteredMobile]}>
          <Ionicons name="chatbubbles-outline" size={36} color="#c7c7cc" />
          <Text style={styles.emptyTitle}>No messages yet</Text>
          <Text style={styles.emptyHint}>Tap the compose button to message a person.</Text>
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
        : row.isAgent
          ? 'New conversation'
          : row.isAi
          ? 'New AI chat'
          : row.isTeam
          ? 'New team chat'
          : row.isGroup
          ? 'New group chat'
          : 'Start the conversation';
      const openMenu = (event) => {
        event?.preventDefault?.();
        event?.stopPropagation?.();
        setMenuConversation(row);
      };
      return (
        <Pressable
          key={row.conversationId}
          onPress={() => openConversation(row.conversationId)}
          onLongPress={openMenu}
          delayLongPress={380}
          {...(Platform.OS === 'web'
            ? {
                className: selected ? 'cgold-dm-row cgold-dm-row-active' : 'cgold-dm-row',
                onContextMenu: openMenu,
              }
            : null)}
          style={({ pressed }) => [
            styles.personRow,
            selected && styles.personRowSelected,
            pressed && styles.rowPressed,
          ]}
          accessibilityLabel={`Conversation with ${conversationTitle(row)}`}
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

  const searchField = (
    <View style={isMobile ? styles.searchWrap : styles.chromeSearchChip}>
      {isMobile ? (
        <>
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
        </>
      ) : (
        <BlurView
          intensity={32}
          tint="light"
          style={styles.chromeSearchBlur}
          {...(Platform.OS === 'web' ? { className: 'cgold-home-chip-blur' } : null)}
        >
          <Ionicons name="search" size={16} color="#8e8e93" />
          <TextInput
            style={styles.chromeSearchInput}
            value={query}
            onChangeText={setQuery}
            placeholder={composeOpen ? 'Search people' : 'Search messages'}
            placeholderTextColor="#8e8e93"
            autoCapitalize="none"
            autoCorrect={false}
          />
          {query ? (
            <Pressable onPress={() => setQuery('')} hitSlop={8}>
              <Ionicons name="close-circle" size={16} color="#c7c7cc" />
            </Pressable>
          ) : null}
        </BlurView>
      )}
    </View>
  );

  const inboxExtras = (
    <>
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
      {isMobile ? (
        <View style={styles.searchToolbarMobile}>{searchField}</View>
      ) : null}
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </>
  );

  const inboxList = (
    <ScrollView
      style={styles.inboxList}
      contentContainerStyle={[
        styles.inboxListContent,
        isMobile && {
          flexGrow: 1,
          paddingTop: 56,
          paddingBottom: mobileTabBarReserve() + 16,
        },
        !isMobile && { flexGrow: 1, paddingTop: 8 },
      ]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      {...(isMobile ? tabBarScroll : null)}
    >
      {inboxExtras}
      {renderInboxList()}
    </ScrollView>
  );

  return (
    <KeyboardAvoidingView
      style={[styles.root, styles.canvasRoot, isMobile && styles.canvasMobile]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {showInbox ? (
        <View style={[styles.inbox, isMobile && styles.inboxMobile, !isMobile && styles.inboxDesktop]}>
          {!isMobile ? (
            <View pointerEvents="box-none" style={styles.chromeRow}>
              <View style={styles.chromeTitle} accessibilityRole="image" accessibilityLabel="Direct Messages">
                <Ionicons name="chatbubbles" size={22} color="#6B5E3A" />
              </View>
              {searchField}
              <Pressable
                onPress={openAgentConversation}
                style={styles.chromeCompose}
                accessibilityLabel="Message the agent"
              >
                <BlurView
                  intensity={32}
                  tint="light"
                  style={styles.chromeComposeBlur}
                  {...(Platform.OS === 'web' ? { className: 'cgold-home-chip-blur' } : null)}
                >
                  <Ionicons name="construct-outline" size={18} color="#1d1d1f" />
                </BlurView>
              </Pressable>
              <Pressable
                onPress={() => {
                  setComposeOpen((current) => !current);
                  setSelectedIds([]);
                  setGroupName('');
                  setQuery('');
                }}
                style={styles.chromeCompose}
                accessibilityLabel={composeOpen ? 'Close compose' : 'Start a conversation'}
              >
                <BlurView
                  intensity={32}
                  tint="light"
                  style={styles.chromeComposeBlur}
                  {...(Platform.OS === 'web' ? { className: 'cgold-home-chip-blur' } : null)}
                >
                  {composeOpen ? (
                    <Ionicons name="close" size={18} color="#1d1d1f" />
                  ) : (
                    <ComposeIcon size={18} color="#1d1d1f" />
                  )}
                </BlurView>
              </Pressable>
            </View>
          ) : null}
          <View style={styles.stage}>
            {inboxList}
          </View>
          {isMobile ? (
            <View pointerEvents="box-none" style={styles.filterDock}>
              <Pressable
                onPress={openAgentConversation}
                style={styles.chromeCircle}
                accessibilityLabel="Message the agent"
              >
                <BlurView
                  intensity={32}
                  tint="light"
                  style={styles.chromeCircleBlur}
                  {...(Platform.OS === 'web' ? { className: 'cgold-mobile-tab-bar' } : null)}
                >
                  <Ionicons name="construct-outline" size={22} color="#1d1d1f" />
                </BlurView>
              </Pressable>
              <Pressable
                onPress={() => {
                  setComposeOpen((current) => !current);
                  setSelectedIds([]);
                  setGroupName('');
                  setQuery('');
                  if (!composeOpen) setActiveId(null);
                }}
                style={styles.chromeCircle}
                accessibilityLabel={composeOpen ? 'Close compose' : 'Start a conversation'}
              >
                <BlurView
                  intensity={32}
                  tint="light"
                  style={styles.chromeCircleBlur}
                  {...(Platform.OS === 'web' ? { className: 'cgold-mobile-tab-bar' } : null)}
                >
                  {composeOpen ? (
                    <Ionicons name="close" size={22} color="#1d1d1f" />
                  ) : (
                    <ComposeIcon size={22} color="#1d1d1f" />
                  )}
                </BlurView>
              </Pressable>
            </View>
          ) : null}
        </View>
      ) : null}

      {showThread ? (
        <View style={[styles.thread, isMobile && styles.canvasMobile, !isMobile && styles.threadDesktop]}>
          {threadLive ? (
            <>
              <View style={[styles.threadHeader, isMobile && styles.threadHeaderMobile]}>
                {isMobile ? (
                  <Pressable
                    onPress={() => {
                      setActiveId(null);
                      setEmojiOpen(false);
                      setDetailsOpen(false);
                      setAddingMembers(false);
                    }}
                    style={styles.threadBackCircle}
                    hitSlop={8}
                    accessibilityLabel="Back to messages"
                  >
                    <BlurView
                      intensity={32}
                      tint="light"
                      style={styles.chromeCircleBlur}
                      {...(Platform.OS === 'web' ? { className: 'cgold-mobile-tab-bar' } : null)}
                    >
                      <Ionicons name="chevron-back" size={22} color="#1d1d1f" />
                    </BlurView>
                  </Pressable>
                ) : null}
                <View style={styles.threadHeaderMain}>
                  <Pressable
                    onPress={() => {
                      if (activeThread.isGroup || activeThread.isAi || activeThread.isAgent) {
                        setTitleDraft(activeThread.title || '');
                        setDetailsOpen(true);
                        setAddingMembers(false);
                        return;
                      }
                      if (activeThread.other) handleOpenProfile(activeThread.other);
                    }}
                    accessibilityLabel={
                      activeThread.isAgent
                        ? 'Agent conversation'
                        : activeThread.isGroup
                        ? 'Group details'
                        : `View ${conversationTitle(activeThread)}'s profile`
                    }
                  >
                    <ConversationAvatar conversation={activeThread} size={36} />
                  </Pressable>
                  <Pressable
                    onPress={() => {
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
                {activeThread.isAgent ? null : (
                <Pressable
                  onPress={() => void handleCallThread()}
                  style={styles.infoButton}
                  accessibilityLabel="Call"
                >
                  <Ionicons name="call-outline" size={20} color={BLUE} />
                </Pressable>
                )}
                <Pressable
                  onPress={() => {
                    setDetailsOpen((current) => {
                      if (!current) setTitleDraft(activeThread.title || '');
                      return !current;
                    });
                    setAddingMembers(false);
                  }}
                  style={styles.infoButton}
                  accessibilityLabel="Chat details"
                >
                  <Ionicons
                    name={detailsOpen ? 'close-circle' : 'information-circle-outline'}
                    size={22}
                    color={BLUE}
                  />
                </Pressable>
              </View>

              {detailsOpen ? (
                <ScrollView
                  style={styles.detailsPanel}
                  contentContainerStyle={[
                    styles.detailsContent,
                    isMobile && styles.detailsContentMobile,
                  ]}
                  keyboardShouldPersistTaps="handled"
                >
                  {activeThread.isAi || activeThread.isAgent ? (
                    <>
                      <Text style={styles.detailsLabel}>Chat</Text>
                      <Text style={styles.detailsTeamName}>{conversationTitle(activeThread)}</Text>
                    </>
                  ) : activeThread.isTeam ? (
                    <>
                      <Text style={styles.detailsLabel}>Team</Text>
                      <Text style={styles.detailsTeamName}>{conversationTitle(activeThread)}</Text>
                    </>
                  ) : activeThread.isGroup ? (
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
                  ) : (
                    <>
                      <Text style={styles.detailsLabel}>Chat</Text>
                      <Text style={styles.detailsTeamName}>{conversationTitle(activeThread)}</Text>
                    </>
                  )}
                  {!activeThread.isAi && !activeThread.isAgent ? (
                    <Text style={styles.detailsLabel}>
                      {activeThread.members.length + 1} people
                    </Text>
                  ) : null}
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
                  {activeThread.isGroup && !activeThread.isTeam && !activeThread.isAi ? (
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
                      {activeThread.isAi || activeThread.isAgent ? 'Delete chat' : 'Delete for you'}
                    </Text>
                  </Pressable>
                  {activeThread.isGroup && !activeThread.isAi ? (
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
                          {activeThread.isAgent
                            ? 'Write what you want changed or built. Send it like a message.'
                            : conversationSubtitle(activeThread)}
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
                                  ? activeThread.isAgent || message.isAgentAck
                                    ? AGENT_CONVERSATION_TITLE
                                    : 'MyCanadaGold AI'
                                  : activeThread.isGroup && !mine
                                    ? firstNameOf(sender)
                                    : null
                              }
                              actionsDisabled={activeThread.isAgent}
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
                      onChangeDraft(`${draft}${emoji}`);
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
                    <View
                      style={[
                        styles.composerField,
                        isMobile && styles.composerFieldMobile,
                      ]}
                    >
                      <TextInput
                        style={[styles.composerInput, isMobile && styles.composerInputMobile]}
                        value={draft}
                        onChangeText={onChangeDraft}
                        placeholder={
                          activeThread?.isAgent
                            ? 'What do you want changed?'
                            : activeThread?.isAi
                              ? 'Message MyCanadaGold AI'
                              : 'Message'
                        }
                        placeholderTextColor="#8e8e93"
                        multiline={false}
                        numberOfLines={1}
                        returnKeyType="send"
                        maxLength={4000}
                        blurOnSubmit={false}
                        onSubmitEditing={() => void handleSend()}
                        onKeyPress={submitFromKeyboard}
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
                Pick a conversation, or message a person.
              </Text>
            </View>
          )}
        </View>
      ) : null}
      <Modal
        visible={Boolean(menuConversation)}
        transparent
        animationType={isMobile ? 'slide' : 'fade'}
        onRequestClose={() => setMenuConversation(null)}
      >
        <View style={[styles.actionSheetRoot, !isMobile && styles.actionSheetRootDesktop]}>
          <Pressable
            style={styles.actionSheetBackdrop}
            onPress={() => setMenuConversation(null)}
            accessibilityLabel="Close"
          />
          <View style={[styles.actionSheetCard, isMobile && styles.actionSheetCardMobile]}>
            <Text style={styles.actionSheetTitle} numberOfLines={1}>
              {menuConversation ? conversationTitle(menuConversation) : ''}
            </Text>
            <Text style={styles.actionSheetBody}>
              {menuConversation?.isAi || menuConversation?.isAgent
                ? 'This chat will be removed from your messages.'
                : menuConversation?.isGroup
                  ? 'This chat will be removed from your messages. Everyone else will still have it.'
                  : `This chat will be removed from your messages. ${
                      menuConversation ? conversationTitle(menuConversation) : 'They'
                    } will still have it.`}
            </Text>
            <Pressable
              onPress={() => {
                const thread = menuConversation;
                setMenuConversation(null);
                if (thread) void handleDeleteConversation(thread);
              }}
              style={({ pressed }) => [
                styles.actionSheetDelete,
                pressed && styles.actionSheetDeletePressed,
              ]}
              accessibilityLabel="Delete conversation"
            >
              <Text style={styles.actionSheetDeleteText}>Delete</Text>
            </Pressable>
            <Pressable
              onPress={() => setMenuConversation(null)}
              style={({ pressed }) => [
                styles.actionSheetCancel,
                pressed && styles.actionSheetCancelPressed,
              ]}
              accessibilityLabel="Cancel"
            >
              <Text style={styles.actionSheetCancelText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
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
    backgroundColor: CANVAS,
  },
  canvasRoot: {
    backgroundColor: CANVAS,
  },
  inbox: {
    width: INBOX_WIDTH,
    borderRightWidth: 0,
    backgroundColor: 'transparent',
    minHeight: 0,
  },
  inboxDesktop: {
    width: 380,
    maxWidth: 420,
    flexShrink: 0,
  },
  inboxMobile: {
    width: '100%',
    borderRightWidth: 0,
    flex: 1,
    height: '100%',
    minHeight: 0,
    overflow: 'hidden',
    backgroundColor: CANVAS,
  },
  canvasMobile: {
    backgroundColor: CANVAS,
  },
  chromeRow: {
    zIndex: 24,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
  },
  chromeTitle: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
  },
  chromeSearchChip: {
    width: 220,
    height: 40,
    borderRadius: 20,
    ...Platform.select({
      web: {
        boxShadow: '0 10px 28px rgba(0,0,0,0.14), 0 1px 3px rgba(0,0,0,0.08)',
      },
      default: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.16,
        shadowRadius: 18,
        elevation: 12,
      },
    }),
  },
  chromeSearchBlur: {
    flex: 1,
    height: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingLeft: 12,
    paddingRight: 10,
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0,0,0,0.08)',
    backgroundColor: 'rgba(255,255,255,0.56)',
  },
  chromeSearchInput: {
    flex: 1,
    minWidth: 0,
    height: 40,
    fontFamily,
    fontSize: 15,
    color: '#1a1a1a',
    outlineStyle: 'none',
  },
  chromeCompose: {
    width: 40,
    height: 40,
    borderRadius: 20,
    overflow: 'hidden',
    ...Platform.select({
      web: {
        cursor: 'pointer',
        boxShadow: '0 10px 28px rgba(0,0,0,0.14), 0 1px 3px rgba(0,0,0,0.08)',
      },
      default: {},
    }),
  },
  chromeComposeBlur: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0,0,0,0.08)',
    backgroundColor: 'rgba(255,255,255,0.56)',
  },
  stage: {
    flex: 1,
    minHeight: 0,
    position: 'relative',
  },
  chromeCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    overflow: 'hidden',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  chromeCircleBlur: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0,0,0,0.08)',
    backgroundColor: 'rgba(255,255,255,0.56)',
  },
  threadBackCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    overflow: 'hidden',
    marginRight: 4,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  filterDock: {
    position: 'absolute',
    top: 6,
    right: 22,
    zIndex: 24,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  deliveryState: {
    fontFamily,
    fontSize: 11,
    color: '#8e8e93',
    marginTop: 4,
    marginRight: 4,
    alignSelf: 'flex-end',
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
  searchToolbarMobile: {
    paddingTop: 4,
    marginBottom: 4,
    gap: 8,
  },
  searchWrap: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
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
    backgroundColor: AI_PURPLE,
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
  inboxCenteredMobile: {
    flexGrow: 1,
    paddingTop: 0,
  },
  personRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 68,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#fff',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
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
    backgroundColor: CANVAS,
  },
  threadDesktop: {
    marginTop: 16,
    marginRight: 16,
    marginBottom: 16,
    backgroundColor: '#fff',
    borderRadius: 24,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0,0,0,0.08)',
    ...Platform.select({
      web: {
        boxShadow: '0 8px 24px rgba(18,16,12,0.08)',
      },
      default: {},
    }),
  },
  threadHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: 'transparent',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(0,0,0,0.08)',
  },
  threadHeaderMobile: {
    paddingTop: 8,
    backgroundColor: CANVAS,
    borderBottomWidth: 0,
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
  detailsContentMobile: {
    paddingBottom: mobileSafeBottom() + 32,
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
  aiMention: {
    color: AI_PURPLE,
    fontWeight: '700',
  },
  aiMentionOnMine: {
    color: '#E4D7FF',
    fontWeight: '700',
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
    paddingBottom: 8 + mobileSafeBottom(),
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
  actionSheetRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  actionSheetRootDesktop: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionSheetBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.36)',
  },
  actionSheetCard: {
    marginHorizontal: 12,
    marginBottom: 28,
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 14,
    borderRadius: 16,
    backgroundColor: '#fff',
    gap: 8,
    width: 360,
    maxWidth: '92%',
    alignSelf: 'center',
  },
  actionSheetCardMobile: {
    marginBottom: 18,
    maxWidth: '100%',
  },
  actionSheetTitle: {
    fontFamily,
    fontSize: 17,
    fontWeight: '600',
    color: '#1d1d1f',
    textAlign: 'center',
  },
  actionSheetBody: {
    fontFamily,
    fontSize: 14,
    lineHeight: 19,
    color: '#8e8e93',
    textAlign: 'center',
    paddingBottom: 6,
  },
  actionSheetDelete: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
    borderRadius: 12,
    backgroundColor: '#fff1f0',
  },
  actionSheetDeletePressed: {
    backgroundColor: '#ffe3e0',
  },
  actionSheetDeleteText: {
    fontFamily,
    fontSize: 17,
    fontWeight: '600',
    color: '#ff3b30',
  },
  actionSheetCancel: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  actionSheetCancelPressed: {
    opacity: 0.6,
  },
  actionSheetCancelText: {
    fontFamily,
    fontSize: 17,
    fontWeight: '500',
    color: BLUE,
  },
});
