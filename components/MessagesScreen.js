import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
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
  findBlankAiDm,
  getOrCreateAiDm,
  getOrCreateDm,
  hideDmConversation,
  hideDmMessage,
  initialsFromName,
  leaveDmGroup,
  listDmContacts,
  listDmInbox,
  listDmMessages,
  mapIncomingDmMessage,
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
  requestStatusLine,
  subscribeAgentRequests,
} from '../lib/agentRequests';
import {
  agentWorkPreview,
  bakingBuild,
  listAgentBuilds,
  publishAgentBuild,
  publishMessageText,
  refreshAgentBuild,
  startAgentBuild,
  subscribeAgentBuilds,
} from '../lib/agentBuilds';
import { fetchAureusEmployee } from '../lib/aureusEmployees';
import { ANALYTICS_CHAT_MODELS, askAnalytics } from '../lib/analyticsChartTools';
import { loadGoogleMapsBrowserKey } from '../lib/aiKeys';
import {
  MAX_ATTACHMENTS,
  attachmentLabel,
  formatBytes,
  pickFiles,
  prepareAttachment,
} from '../lib/aiAttachments';
import { uploadDmAttachments } from '../lib/dmAttachments';
import { CANVAS, DESKTOP_TOP_BAR_HEIGHT, MOBILE, NAV_TAB_ACTIVE_BG, NAV_TAB_ACTIVE_RADIUS } from '../lib/mobileUi';
import { mobileTabBarReserve, useMobileTabBarScrollProps } from '../lib/mobileTabBar';
import { useLiveRefresh } from '../lib/liveRefresh';
import {
  MAX_AGENT_REQUEST_IMAGES,
  normalizeAgentRequestImages,
  uploadAgentRequestPhotos,
} from '../lib/agentRequestPhotos';
import { FONT } from '../lib/typography';
import { MobileFeedTopBarActions } from './MobileChrome';
import SendFromInput from './SendFromInput';
import { pickTriagePhotos } from './TriageCorrectionImages';
import { listStaffProfiles, useAppAccess } from '../lib/permissions';
import ProfilePhotoModal from './ProfilePhotoModal';
import {
  AgentPreviewSheet,
  AgentPreviewTv,
  AgentPublishButton,
  AgentPublishSheet,
  openPreviewUrl,
} from './AgentPreviewTv';
import { usePhoneCalls } from './PhoneCallProvider';

// The AI conversation is the Analytics panel itself, hosted in the thread pane.
const AnalyticsAiPanel = lazy(() => import('./AnalyticsAiPanel'));
const AnalyticsChartCard = lazy(() => import('./AnalyticsChartCard'));
const AnalyticsMapCard = lazy(() => import('./AnalyticsMapCard'));
const AnalyticsTableCard = lazy(() => import('./AnalyticsTableCard'));
const AnalyticsFileCard = lazy(() => import('./AnalyticsFileCard'));
const AI_TITLE = 'MyCanadaGold AI';

const fontFamily = FONT;

// Same visual tokens as AnalyticsAiPanel so both chats read as one product.
const BLUE = '#1a1a1a';
const INK = '#1a1a1a';
const CHIP_BORDER = '#d0d0d0';
const CHIP_RADIUS = 6;
const RULE = 'rgba(42,38,30,0.08)';
const SECONDARY = '#8e8e93';
const BUBBLE_RADIUS = 20;
const BUBBLE_TAIL = 5;
const BUBBLE_MINE = MOBILE.blue;
const BUBBLE_THEM_BG = '#e9e9eb';
const BUBBLE_THEM_BORDER = 'rgba(60, 60, 67, 0.08)';
const COMPOSER_LINE_HEIGHT = 22;
const COMPOSER_MAX_LINES = 4;
const CHIP_SHADOW = Platform.select({
  web: { boxShadow: '0 1px 2px rgba(0,0,0,0.05)' },
  default: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 2,
    elevation: 1,
  },
});
const COMPOSER_PILL_IDLE_SHADOW = Platform.select({
  web: { boxShadow: '0 1px 2px rgba(0,0,0,0.03)' },
  default: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 2,
    elevation: 0,
  },
});
const COMPOSER_PILL_ACTIVE_SHADOW = Platform.select({
  web: { boxShadow: '0 2px 8px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)' },
  default: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 5,
    elevation: 1,
  },
});
const INBOX_WIDTH = 340;
const AGENT_BACKGROUNDS = [
  '#000000',
  '#1C1C1E',
  '#FFFFFF',
  '#F2F2F7',
  '#FF3B30',
  '#34C759',
  '#0A84FF',
  '#FF9500',
  '#AF52DE',
  '#FF2D55',
  '#FFD60A',
  '#5AC8FA',
  '#5856D6',
  '#8E8E93',
];
const AGENT_ICON_COLORS = [
  '#000000',
  '#FFFFFF',
  '#FF3B30',
  '#34C759',
  '#0A84FF',
  '#FFD60A',
  '#FF9500',
  '#AF52DE',
  '#FF2D55',
  '#5AC8FA',
];

function hashString(value) {
  const text = String(value || '');
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function hexLuminance(hex) {
  const n = String(hex || '').replace('#', '');
  if (n.length < 6) return 0;
  const r = parseInt(n.slice(0, 2), 16) / 255;
  const g = parseInt(n.slice(2, 4), 16) / 255;
  const b = parseInt(n.slice(4, 6), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function agentAvatarTheme(conversationId) {
  const hash = hashString(conversationId || 'agent');
  const bg = AGENT_BACKGROUNDS[hash % AGENT_BACKGROUNDS.length];
  const bgLum = hexLuminance(bg);
  const candidates = AGENT_ICON_COLORS.filter((color) => {
    if (color.toLowerCase() === bg.toLowerCase()) return false;
    return Math.abs(hexLuminance(color) - bgLum) > 0.32;
  });
  const pool = candidates.length
    ? candidates
    : bgLum > 0.55
      ? ['#000000', '#FF3B30', '#0A84FF', '#34C759']
      : ['#FFFFFF', '#FFD60A', '#34C759', '#5AC8FA'];
  return {
    bg,
    icon: pool[Math.floor(hash / AGENT_BACKGROUNDS.length) % pool.length],
    lightBg: bgLum > 0.82,
  };
}
const MOBILE_BREAKPOINT = 768;
// "@ai" inside a human chat answers with the same Analytics tools as the AI chat.
const AI_MENTION_MODEL = ANALYTICS_CHAT_MODELS[0]?.key || '';

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

function mentionDraftQuery(text) {
  const match = String(text || '').match(/(^|[\s([{<"'“‘])@([^\s]*)$/);
  return match ? String(match[2] || '').toLowerCase() : null;
}

function insertAiMention(text) {
  const source = String(text || '');
  if (mentionDraftQuery(source) != null) {
    return source.replace(/(^|[\s([{<"'“‘])@([^\s]*)$/, '$1@ai ');
  }
  if (mentionsAi(source)) return source.endsWith(' ') ? source : `${source} `;
  return source ? `${source.replace(/\s+$/, '')} @ai ` : '@ai ';
}

function attachmentIcon(kind) {
  if (kind === 'image') return 'image-outline';
  if (kind === 'video') return 'videocam-outline';
  if (kind === 'spreadsheet') return 'grid-outline';
  if (kind === 'pdf') return 'document-text-outline';
  if (kind === 'document') return 'document-outline';
  return 'attach-outline';
}

function AttachmentChips({ items, onRemove, mine }) {
  const list = (Array.isArray(items) ? items : []).filter((item) => item && item.kind !== 'image');
  if (!list.length) return null;
  return (
    <View style={[styles.attachRow, mine && styles.attachRowMine]}>
      {list.map((item) => (
        <View key={item.id} style={[styles.attachChip, mine && styles.attachChipMine]}>
          {item.thumb ? (
            <Image source={{ uri: item.thumb }} style={styles.attachThumb} accessibilityIgnoresInvertColors />
          ) : (
            <View style={[styles.attachIcon, mine && styles.attachIconMine]}>
              <Ionicons name={attachmentIcon(item.kind)} size={14} color={mine ? '#fff' : INK} />
            </View>
          )}
          <View style={styles.attachCopy}>
            <Text style={[styles.attachName, mine && styles.attachNameMine]} numberOfLines={1}>
              {item.name}
            </Text>
            <Text style={[styles.attachMeta, mine && styles.attachMetaMine]} numberOfLines={1}>
              {[attachmentLabel(item), item.summary || (item.size ? formatBytes(item.size) : '')].filter(Boolean).join(' · ')}
            </Text>
          </View>
          {onRemove ? (
            <Pressable
              onPress={() => onRemove(item.id)}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${item.name}`}
              style={styles.attachRemove}
            >
              <Ionicons name="close" size={14} color={SECONDARY} />
            </Pressable>
          ) : null}
        </View>
      ))}
    </View>
  );
}

function PendingAttachChips({ items, onRemove }) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return null;
  return (
    <View style={styles.attachRow}>
      {list.map((item) => (
        <View key={item.id} style={styles.attachChip}>
          {item.thumb ? (
            <Image source={{ uri: item.thumb }} style={styles.attachThumb} accessibilityIgnoresInvertColors />
          ) : (
            <View style={styles.attachIcon}>
              <Ionicons name={attachmentIcon(item.kind)} size={14} color={INK} />
            </View>
          )}
          <View style={styles.attachCopy}>
            <Text style={styles.attachName} numberOfLines={1}>
              {item.name}
            </Text>
            <Text style={styles.attachMeta} numberOfLines={1}>
              {[attachmentLabel(item), item.summary || (item.size ? formatBytes(item.size) : '')].filter(Boolean).join(' · ')}
            </Text>
          </View>
          <Pressable
            onPress={() => onRemove(item.id)}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={`Remove ${item.name}`}
            style={styles.attachRemove}
          >
            <Ionicons name="close" size={14} color={SECONDARY} />
          </Pressable>
        </View>
      ))}
    </View>
  );
}

function MessageViz({ charts, mapsKey, onOpenCustomer, onOpenDocument }) {
  const list = (Array.isArray(charts) ? charts : []).filter((item) => item && item.type);
  if (!list.length) return null;
  return (
    <View style={styles.vizBlock}>
      <Suspense fallback={<ActivityIndicator color={INK} style={styles.vizSpinner} />}>
        {list.map((chart, index) =>
          chart.type === 'map' ? (
            <AnalyticsMapCard
              key={`${chart.type}-${index}`}
              chart={chart}
              apiKey={mapsKey}
              onOpenCustomer={onOpenCustomer}
            />
          ) : chart.type === 'table' ? (
            <AnalyticsTableCard
              key={`${chart.type}-${index}`}
              chart={chart}
              onOpenTicket={onOpenDocument ? (ref) => onOpenDocument(ref) : null}
            />
          ) : chart.type === 'file' ? (
            <AnalyticsFileCard key={`${chart.type}-${index}`} chart={chart} />
          ) : (
            <AnalyticsChartCard key={`${chart.type}-${index}`} chart={chart} />
          ),
        )}
      </Suspense>
    </View>
  );
}

function formatDmThreadForAi({ messages, peopleById, myId, myName, thread }) {
  const title = conversationTitle(thread);
  const lines = (messages || [])
    .slice(-40)
    .map((item) => {
      const files = (item.attachments || []).map((file) => file.name).filter(Boolean);
      const body = String(item.body || '').replace(/\s+/g, ' ').trim().slice(0, 400);
      if (!body && !files.length) return '';
      const extra = files.length ? ` [${files.join(', ')}]` : '';
      const name = item.isAssistant
        ? 'MyCanadaGold AI'
        : item.senderId === myId
          ? myName || 'You'
          : contactName(peopleById?.get?.(item.senderId)) || 'Teammate';
      return `${name}: ${body || 'Attachment'}${extra}`;
    })
    .filter(Boolean);
  return [
    'You are MyCanadaGold AI answering inside a staff Direct Message. Everyone in this chat can see your reply.',
    'You have the same tools and company data as Analytics: transactions, inventory, hours, charts, maps, documents, and the rest.',
    `Thread: ${title}`,
    'Use this conversation as context and answer the latest @AI request. Be concise and specific.',
    lines.length ? `Recent messages:\n${lines.join('\n')}` : 'No earlier messages.',
  ].join('\n\n');
}

function MessageImages({ urls, mine }) {
  const list = (Array.isArray(urls) ? urls : []).filter(Boolean);
  if (!list.length) return null;
  return (
    <View style={styles.messageImages}>
      {list.map((uri, index) => (
        <Image
          key={`${uri}-${index}`}
          source={{ uri }}
          style={styles.messageImage}
          accessibilityLabel="Attached photo"
        />
      ))}
    </View>
  );
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

function ConversationAvatar({ conversation, size = 52 }) {
  if (conversation?.isAgent) {
    const theme = agentAvatarTheme(conversation.conversationId || conversation.title || 'agent');
    const badge = Math.max(16, Math.round(size * 0.4));
    return (
      <View style={{ width: size, height: size }}>
        <View
          style={[
            styles.avatar,
            {
              width: size,
              height: size,
              borderRadius: size / 2,
              backgroundColor: theme.bg,
              borderWidth: theme.lightBg ? 1 : 0,
              borderColor: theme.lightBg ? '#d1d1d6' : 'transparent',
            },
          ]}
        >
          <MaterialCommunityIcons
            name="robot"
            size={Math.max(16, Math.round(size * 0.48))}
            color={theme.icon}
          />
        </View>
        <View
          style={[
            styles.agentToolsBadge,
            {
              width: badge,
              height: badge,
              borderRadius: badge / 2,
            },
          ]}
        >
          <Ionicons name="construct" size={Math.max(8, Math.round(badge * 0.58))} color="#1d1d1f" />
        </View>
      </View>
    );
  }
  if (conversation?.isAi) {
    // Same mark Analytics puts beside its replies.
    return (
      <View
        style={[
          styles.avatar,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: BUBBLE_THEM_BG,
          },
        ]}
      >
        <Ionicons name="sparkles" size={Math.max(14, Math.round(size * 0.5))} color={BUBBLE_MINE} />
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

function deliveryLabel(state) {
  if (state === 'sending') return 'Sending';
  if (state === 'sent') return 'Sent';
  if (state === 'received') return 'Received';
  return '';
}

/** The small circle beside a received cluster: the sender, or the AI mark for assistant replies. */
function TurnAvatar({ message, sender, conversation }) {
  if (message.isAssistant) {
    if (conversation?.isAgent || message.isAgentAck) {
      return <ConversationAvatar conversation={conversation} size={28} />;
    }
    return (
      <View style={styles.turnAvatar}>
        <Ionicons name="sparkles" size={14} color={BUBBLE_MINE} />
      </View>
    );
  }
  if (sender) return <PersonAvatar person={sender} size={28} />;
  return <View style={styles.turnAvatar} />;
}

function MessageBubble({
  message,
  mine,
  groupedWithPrev,
  groupedWithNext,
  senderLabel,
  sender,
  conversation,
  menuOpen,
  onOpenMenu,
  onCloseMenu,
  onToggleLike,
  onDeleteForMe,
  onSendSettled,
  composerRef,
  actionsDisabled = false,
  mapsKey = '',
  onOpenCustomer,
  onOpenDocument,
}) {
  const lastTap = useRef(0);
  const [burst, setBurst] = useState(0);
  const [hovered, setHovered] = useState(false);
  const radius = BUBBLE_RADIUS;
  // Same corners as Analytics: a short tail on the sender's bottom corner,
  // tighter joins inside a cluster.
  const cluster = {
    borderTopLeftRadius: !mine && groupedWithPrev ? BUBBLE_TAIL : radius,
    borderBottomLeftRadius: !mine ? BUBBLE_TAIL : radius,
    borderTopRightRadius: mine && groupedWithPrev ? BUBBLE_TAIL : radius,
    borderBottomRightRadius: mine ? BUBBLE_TAIL : radius,
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

  const body = (
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
            {message.body &&
            !(
              (message.imageUrls?.length || message.attachments?.length)
              && (message.body === '(Photo attached)' || message.body === '(Attachment)')
            ) ? (
              <MessageBody body={message.body} mine={mine} />
            ) : null}
            <MessageImages urls={message.imageUrls} mine={mine} />
            <AttachmentChips items={message.attachments} mine={mine} />
            {mine && message.requestStatusLine ? (
              <Text style={[styles.requestStatusInBubble, mine && styles.requestStatusInBubbleMine]}>
                {message.requestStatusLine}
              </Text>
            ) : null}
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
  );

  const viz = (
    <MessageViz
      charts={message.charts}
      mapsKey={mapsKey}
      onOpenCustomer={onOpenCustomer}
      onOpenDocument={onOpenDocument}
    />
  );

  if (mine) {
    return (
      <View style={styles.turnBlock}>
        <View style={[styles.turnRow, styles.turnRowMine]}>
          <SendFromInput
            active={Boolean(message.justSent)}
            originRef={composerRef}
            onSettled={() => onSendSettled?.(message)}
          >
            {body}
          </SendFromInput>
        </View>
        {viz}
      </View>
    );
  }
  return (
    <View style={styles.turnBlock}>
      <View style={[styles.turnRow, styles.turnRowTheirs]}>
        <View style={styles.turnAvatarSlot}>
          {groupedWithNext ? null : <TurnAvatar message={message} sender={sender} conversation={conversation} />}
        </View>
        {body}
      </View>
      {viz}
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

export default function MessagesScreen({
  session,
  onUnreadChange,
  openUserId,
  onOpenedUser,
  openAiKey,
  onOpenedAi,
  onOpenProfile,
  onMobileHeader,
  onOpenThreadChange,
  onOpenCustomer,
  onOpenDocument,
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
  const [agentBuilds, setAgentBuilds] = useState({});
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewRefreshing, setPreviewRefreshing] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [agentDraftImages, setAgentDraftImages] = useState([]);
  const [agentPhotoBusy, setAgentPhotoBusy] = useState(false);
  const [pendingFiles, setPendingFiles] = useState([]);
  const [attaching, setAttaching] = useState('');
  const [aiStartBlank, setAiStartBlank] = useState(false);
  const [mapsKey, setMapsKey] = useState('');
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
  const [aiThinkingId, setAiThinkingId] = useState(null);
  const [error, setError] = useState('');
  const [photoPerson, setPhotoPerson] = useState(null);
  const [menuConversation, setMenuConversation] = useState(null);
  const [menuMessageId, setMenuMessageId] = useState(null);
  const threadRef = useRef(null);
  const sendScale = useRef(new Animated.Value(1)).current;
  const composerPillRef = useRef(null);
  const composerInputRef = useRef(null);
  const [inputHeight, setInputHeight] = useState(COMPOSER_LINE_HEIGHT);
  const [composerHover, setComposerHover] = useState(false);
  const [composerFocus, setComposerFocus] = useState(false);
  const composerMaxHeight = COMPOSER_LINE_HEIGHT * COMPOSER_MAX_LINES;
  const draftRef = useRef('');
  const sendingRef = useRef(false);
  const typingRef = useRef(null);
  const activeIdRef = useRef(null);
  const inboxRef = useRef(inbox);
  const agentInboxRef = useRef(agentInbox);
  const agentMessagesRef = useRef(agentMessages);
  const agentBuildsRef = useRef(agentBuilds);
  inboxRef.current = inbox;
  agentInboxRef.current = agentInbox;
  agentMessagesRef.current = agentMessages;
  agentBuildsRef.current = agentBuilds;
  activeIdRef.current = activeId;
  draftRef.current = draft;
  const onUnreadChangeRef = useRef(onUnreadChange);
  onUnreadChangeRef.current = onUnreadChange;
  const onMobileHeaderRef = useRef(onMobileHeader);
  onMobileHeaderRef.current = onMobileHeader;
  const onOpenThreadChangeRef = useRef(onOpenThreadChange);
  onOpenThreadChangeRef.current = onOpenThreadChange;
  const refreshInboxRef = useRef(async () => []);
  const refreshAgentRequestsRef = useRef(async () => {});

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

  useEffect(() => {
    const report = onOpenThreadChangeRef.current;
    if (!report) return;
    if (!isMobile || !activeId) {
      report(null);
      return;
    }
    if (!activeThread) return;
    const person = activeThread.other;
    const kind = activeThread.isAgent
      ? 'agent'
      : activeThread.isAi
        ? 'ai'
        : activeThread.isTeam
          ? 'team'
          : activeThread.isGroup
            ? 'group'
            : 'person';
    report({
      kind,
      label: conversationTitle(activeThread),
      avatarUrl: person?.avatarUrl || '',
      name: person ? contactName(person) : conversationTitle(activeThread),
    });
  }, [activeId, activeThread, isMobile]);

  const refreshInbox = useCallback(async () => {
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
      setPendingFiles([]);
      setAttaching('');
      const agentThread = agentInboxRef.current.find((row) => row.conversationId === conversationId);
      if (agentThread) {
        setMessages(agentMessagesRef.current[conversationId] || []);
        setLoadingThread(false);
        void refreshAgentRequestsRef.current();
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
    refreshInbox();
  }, [refreshInbox]);

  useEffect(() => {
    const unsubscribe = subscribeDmRealtime({
      onMessage: (payload) => {
        const row = payload.new || payload.old;
        const conversationId = row?.conversation_id;
        if (payload.eventType === 'INSERT' && row?.id) {
          if (conversationId === activeIdRef.current) {
            void mapIncomingDmMessage(row, myId).then((incoming) => {
              if (incoming.conversationId !== activeIdRef.current) return;
              setMessages((current) => {
                if (current.some((item) => item.id === incoming.id)) {
                  return current.map((item) => (item.id === incoming.id ? { ...item, ...incoming, localKey: item.localKey, justSent: item.justSent } : item));
                }
                const tempIndex = current.findIndex(
                  (item) =>
                    item.localKey &&
                    String(item.id).startsWith('temp-') &&
                    item.body === incoming.body &&
                    item.senderId === incoming.senderId,
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
    let alive = true;
    loadGoogleMapsBrowserKey()
      .then((key) => {
        if (alive) setMapsKey(key);
      })
      .catch(() => {
        if (alive) setMapsKey('');
      });
    return () => {
      alive = false;
    };
  }, []);

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
      const hay = `${conversationTitle(row)} ${(row.members || []).map(contactName).join(' ')} ${
        row.isAgent ? agentWorkPreview(agentBuilds[row.conversationId]) : row.lastMessagePreview
      }`.toLowerCase();
      return hay.includes(q);
    });
  }, [agentBuilds, composeOpen, mergedInbox, query]);

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
      setAgentBuilds((current) => {
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

  useEffect(() => {
    if (!draft) setInputHeight(COMPOSER_LINE_HEIGHT);
  }, [draft]);

  const syncInputHeight = (event) => {
    const raw = event?.nativeEvent?.contentSize?.height;
    if (!Number.isFinite(raw) || raw <= 0) return;
    setInputHeight(Math.min(composerMaxHeight, Math.max(COMPOSER_LINE_HEIGHT, Math.ceil(raw))));
  };

  const handleAttachFiles = async () => {
    if (attaching || sending || activeThread?.isAgent) return;
    let files = [];
    try {
      files = await pickFiles();
    } catch (err) {
      setError(err?.message || 'Could not open the file picker.');
      return;
    }
    if (!files.length) return;
    const room = MAX_ATTACHMENTS - pendingFiles.length;
    if (room <= 0) {
      setError(`Up to ${MAX_ATTACHMENTS} files per message.`);
      return;
    }
    setError('');
    const problems = [];
    for (const file of files.slice(0, room)) {
      setAttaching(`Reading ${file.name || 'file'}…`);
      try {
        const prepared = await prepareAttachment(file);
        setPendingFiles((current) => (
          current.length < MAX_ATTACHMENTS ? [...current, { ...prepared, file }] : current
        ));
      } catch (err) {
        problems.push(err?.message || `Could not read ${file.name || 'that file'}.`);
      }
    }
    if (files.length > room) problems.push(`Only ${MAX_ATTACHMENTS} files per message; the rest were skipped.`);
    setAttaching('');
    if (problems.length) setError(problems.join(' '));
  };

  const handleAttachAgentPhotos = async () => {
    if (!activeThread?.isAgent || agentPhotoBusy) return;
    const remaining = MAX_AGENT_REQUEST_IMAGES - agentDraftImages.length;
    if (remaining <= 0) {
      setError(`You can attach up to ${MAX_AGENT_REQUEST_IMAGES} photos.`);
      return;
    }
    setAgentPhotoBusy(true);
    try {
      const picked = await pickTriagePhotos({ remaining });
      if (picked.error) setError(picked.error);
      if (picked.images?.length) {
        setAgentDraftImages((current) =>
          normalizeAgentRequestImages([...current, ...picked.images]),
        );
      }
    } finally {
      setAgentPhotoBusy(false);
    }
  };

  const handleSend = async () => {
    const text = draft.trim();
    const pendingImages = activeThread?.isAgent ? normalizeAgentRequestImages(agentDraftImages) : [];
    const outgoingFiles = activeThread?.isAgent ? [] : pendingFiles;
    if ((!text && !pendingImages.length && !outgoingFiles.length) || !activeId || sending || sendingRef.current) return;
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
      const localImages = pendingImages.map((image) => image.uri).filter(Boolean);
      setDraft('');
      setAgentDraftImages([]);
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
          imageUrls: localImages,
          createdAt: new Date().toISOString(),
          likedByMe: false,
          likeCount: 0,
          isAssistant: false,
          deliveryState: 'sending',
          pending: true,
        },
      ]);
      try {
        const uploadedUrls = localImages.length
          ? await uploadAgentRequestPhotos(pendingImages, conversationId)
          : [];
        const saved = await createAgentRequest({
          conversationId,
          body: text,
          senderId: myId,
          imageUrls: uploadedUrls,
        });
        const sentAt = saved.createdAt || new Date().toISOString();
        const sentMessage = {
          id: saved.id,
          localKey,
          justSent: true,
          conversationId,
          senderId: saved.senderId || myId,
          body: saved.body || text,
          imageUrls: saved.imageUrls?.length ? saved.imageUrls : uploadedUrls,
          createdAt: sentAt,
          likedByMe: false,
          likeCount: 0,
          isAssistant: false,
          deliveryState: 'sent',
          requestStatus: saved.status,
          approvalState: saved.approvalState,
          approvalReason: saved.approvalReason,
          requestStatusLine: requestStatusLine(saved),
        };
        setMessages((current) => mergeSentMessage(current, localKey, tempId, sentMessage));
        // The TV switches to "Baking" right away; the proxy answer replaces this.
        // Drop the previous run's preview: it is the app before this message.
        const previousBuild = agentBuildsRef.current[conversationId] || null;
        if (!saved.localOnly) {
          setAgentBuilds((current) => ({
            ...current,
            [conversationId]: {
              ...(previousBuild || bakingBuild(conversationId, myId)),
              status: 'baking',
              previewUrl: '',
              progressNote: 'Sending to the agent',
              progressPct: 0,
              error: '',
              localOnly: true,
            },
          }));
        }
        const [, startedBuild] = await Promise.all([
          forwardAgentRequest(saved),
          saved.localOnly
            ? Promise.resolve(null)
            : startAgentBuild({ requestId: saved.id, conversationId, senderId: myId }),
        ]);
        if (!saved.localOnly) {
          setAgentBuilds((current) => {
            const next = { ...current };
            if (startedBuild) next[conversationId] = startedBuild;
            else if (previousBuild) next[conversationId] = previousBuild;
            else delete next[conversationId];
            return next;
          });
        }
        const receivedMessage = { ...sentMessage, deliveryState: 'received' };
        const ack = {
          id: `${saved.id}-ack`,
          conversationId,
          senderId: null,
          body: agentReceivedCopy(saved),
          createdAt: sentAt,
          likedByMe: false,
          likeCount: 0,
          isAssistant: true,
          isAgentAck: true,
          deliveryState: 'received',
          requestStatus: saved.status,
          approvalState: saved.approvalState,
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
        setAgentDraftImages(pendingImages);
        setError(err.message || 'Could not send that request.');
      } finally {
        sendingRef.current = false;
        setSending(false);
      }
      return;
    }
    const preparedFiles = outgoingFiles;
    const localImages = preparedFiles
      .filter((item) => item.kind === 'image' && (item.thumb || item.images?.[0]))
      .map((item) => item.thumb || item.images[0]);
    setDraft('');
    setPendingFiles([]);
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
        attachments: preparedFiles,
        imageUrls: localImages,
        createdAt: new Date().toISOString(),
        likedByMe: false,
        likeCount: 0,
        pending: true,
      },
    ]);
    try {
      const uploaded = preparedFiles.length
        ? await uploadDmAttachments(activeId, preparedFiles)
        : [];
      const saved = await sendDmMessage(activeId, text, { attachments: uploaded });
      setMessages((current) => mergeSentMessage(current, localKey, tempId, saved));
      await refreshInbox();
      sendingRef.current = false;
      setSending(false);
      if (!mentionsAi(text)) return;
      const conversationId = activeId;
      const thread = activeThread;
      setAiThinkingId(conversationId);
      try {
        const prior = messages.filter((item) => item.body && !String(item.id).startsWith('temp-'));
        const question = text.replace(AI_MENTION_RE, '$1').trim()
          || (preparedFiles.length ? 'Look at the attached files and answer in this chat.' : text);
        const result = await askAnalytics({
          model: AI_MENTION_MODEL,
          history: [
            {
              role: 'user',
              content: formatDmThreadForAi({ messages: prior, peopleById, myId, myName, thread }),
            },
            { role: 'assistant', content: 'Understood. I have the thread. What is the question?' },
          ],
          question,
          attachments: preparedFiles,
          session,
          mapsKey,
        });
        const reply = await sendDmMessage(conversationId, result.text || 'I could not answer that.', {
          assistant: true,
          charts: result.charts || [],
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
      setPendingFiles(preparedFiles);
      setError(err.message || 'Could not send that message.');
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };

  const submitFromKeyboard = (event) => {
    const key = event?.nativeEvent?.key || event?.key;
    if (key !== 'Enter') return;
    if (event?.nativeEvent?.shiftKey || event?.shiftKey) return;
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

  const mentionQuery = mentionDraftQuery(draft);
  const showAiMention = mentionQuery != null && 'ai'.startsWith(mentionQuery);
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
      const blank = findBlankAiDm(inboxRef.current);
      const conversationId = blank?.conversationId || (await getOrCreateAiDm());
      setAiStartBlank(true);
      await refreshInbox();
      await openConversation(conversationId);
    } catch (err) {
      setError(err.message || 'Could not open MyCanadaGold AI.');
    }
  }, [openConversation, refreshInbox]);

  const openedAiRef = useRef(0);
  useEffect(() => {
    if (!openAiKey) {
      openedAiRef.current = 0;
      return;
    }
    if (openedAiRef.current === openAiKey) return;
    openedAiRef.current = openAiKey;
    void openAiConversation().finally(() => onOpenedAi?.());
  }, [openAiKey, openAiConversation, onOpenedAi]);

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

  const applyAgentSnapshot = useCallback((grouped) => {
    setAgentInbox((current) => {
      const persisted = new Set(grouped.inbox.map((row) => row.conversationId));
      const locals = current.filter((row) => row.isAgent && !persisted.has(row.conversationId));
      return [...grouped.inbox, ...locals];
    });
    setAgentMessages((current) => {
      const next = { ...grouped.messages };
      Object.keys(current).forEach((id) => {
        const local = current[id] || [];
        const server = next[id];
        if (!server) {
          next[id] = local;
          return;
        }
        const seen = new Set(server.map((item) => item.id));
        const extras = local.filter((item) => !seen.has(item.id));
        next[id] = extras.length ? [...server, ...extras] : server;
      });
      return next;
    });
    const openId = activeIdRef.current;
    if (openId && grouped.messages[openId]) {
      setMessages((current) => {
        const seen = new Set(grouped.messages[openId].map((item) => item.id));
        const extras = current.filter((item) => !seen.has(item.id));
        return extras.length ? [...grouped.messages[openId], ...extras] : grouped.messages[openId];
      });
    }
  }, []);

  const refreshAgentRequests = useCallback(async () => {
    try {
      const rows = await listAgentRequests();
      applyAgentSnapshot(groupAgentConversations(rows, myId));
    } catch {
      // Table is not on the live project until this migration is applied.
    }
  }, [applyAgentSnapshot, myId]);

  useEffect(() => {
    void refreshAgentRequests();
  }, [refreshAgentRequests]);

  useEffect(() => {
    const unsubscribe = subscribeAgentRequests(() => {
      void refreshAgentRequests();
    });
    return unsubscribe;
  }, [refreshAgentRequests]);

  refreshAgentRequestsRef.current = refreshAgentRequests;

  useLiveRefresh(refreshAgentRequests, 20_000, Boolean(myId));

  const refreshAgentBuilds = useCallback(async () => {
    try {
      const rows = await listAgentBuilds();
      setAgentBuilds((current) => {
        const next = {};
        rows.forEach((row) => {
          next[row.conversationId] = row;
        });
        // Keep optimistic "baking" rows the server has not written yet.
        Object.keys(current).forEach((id) => {
          if (!next[id] && current[id]?.localOnly) next[id] = current[id];
        });
        return next;
      });
    } catch {
      // Table is not on the live project until this migration is applied.
    }
  }, []);

  useEffect(() => {
    void refreshAgentBuilds();
  }, [refreshAgentBuilds]);

  useEffect(() => {
    const unsubscribe = subscribeAgentBuilds(() => {
      void refreshAgentBuilds();
    });
    return unsubscribe;
  }, [refreshAgentBuilds]);

  // The proxy only talks to Cursor / Vercel when asked, so poll while anything bakes.
  const pollBakingBuilds = useCallback(async () => {
    const baking = Object.values(agentBuildsRef.current).filter(
      (row) => row && row.status === 'baking' && !row.localOnly,
    );
    if (!baking.length) return;
    const openId = activeIdRef.current;
    const ordered = baking.slice().sort((left, right) => {
      if (left.conversationId === openId) return -1;
      if (right.conversationId === openId) return 1;
      return 0;
    });
    for (const row of ordered.slice(0, 4)) {
      try {
        const synced = await refreshAgentBuild(row.conversationId);
        if (synced) {
          setAgentBuilds((current) => ({ ...current, [row.conversationId]: synced }));
        }
      } catch {
        // Keep the last known state; the next tick retries.
      }
    }
  }, []);

  const anyBaking = Object.values(agentBuilds).some((row) => row?.status === 'baking' && !row.localOnly);
  useLiveRefresh(pollBakingBuilds, 15_000, Boolean(myId) && anyBaking);

  const activeBuild = activeThread?.isAgent ? agentBuilds[activeThread.conversationId] || null : null;

  const handlePreviewRefresh = useCallback(async () => {
    const conversationId = activeIdRef.current;
    if (!conversationId || previewRefreshing) return;
    setPreviewRefreshing(true);
    try {
      const synced = await refreshAgentBuild(conversationId);
      if (synced) setAgentBuilds((current) => ({ ...current, [conversationId]: synced }));
    } catch (err) {
      setError(err.message || 'Could not check the preview.');
    } finally {
      setPreviewRefreshing(false);
    }
  }, [previewRefreshing]);

  useEffect(() => {
    if (!activeThread?.isAgent) {
      setPreviewOpen(false);
      setPublishOpen(false);
      setAgentDraftImages([]);
    }
  }, [activeThread?.isAgent, activeId]);

  const leaveAgentThread = useCallback(() => {
    setActiveId(null);
    setEmojiOpen(false);
    setDetailsOpen(false);
    setAddingMembers(false);
    setAgentDraftImages([]);
  }, []);

  const openPublish = useCallback(() => {
    setPublishOpen(true);
  }, []);

  const agentMobileHeaderTrailing = useMemo(
    () => (
      <MobileFeedTopBarActions>
        <AgentPublishButton build={activeBuild} onPress={openPublish} busy={publishing} />
      </MobileFeedTopBarActions>
    ),
    [activeBuild, openPublish, publishing],
  );

  useEffect(() => {
    const setHeader = onMobileHeaderRef.current;
    if (!setHeader || !isMobile) return undefined;
    if (showThread && activeThread?.isAgent) {
      setHeader({
        segments: [{ label: conversationTitle(activeThread) }],
        onBrandPress: leaveAgentThread,
        trailing: agentMobileHeaderTrailing,
      });
    } else {
      setHeader(null);
    }
    return () => setHeader(null);
  }, [activeThread, agentMobileHeaderTrailing, isMobile, leaveAgentThread, showThread]);

  const handlePublish = useCallback(async () => {
    const conversationId = activeIdRef.current;
    const build = conversationId ? agentBuildsRef.current[conversationId] : null;
    if (!conversationId || !build || publishing) return;
    setPublishing(true);
    setError('');
    try {
      const saved = await publishAgentBuild(conversationId);
      if (saved) setAgentBuilds((current) => ({ ...current, [conversationId]: saved }));

      const firstRequest = (agentMessagesRef.current[conversationId] || []).find(
        (item) => !item.isAssistant && item.body,
      );
      const text = publishMessageText({
        requesterName: myName,
        requestText: firstRequest?.body || '',
        build: saved || build,
      });
      // Gilmour only — never fan this out as a staff DM.
      void forwardAgentRequest({
        id: null,
        body: text,
        senderId: myId,
        createdAt: new Date().toISOString(),
        kind: 'publish_request',
      });
      setPublishOpen(false);
      void refreshAgentRequestsRef.current();
    } catch (err) {
      setError(err.message || 'Could not publish that change.');
    } finally {
      setPublishing(false);
    }
  }, [myId, myName, publishing]);

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
          style={({ hovered, pressed }) => [
            styles.personRow,
            isMobile && styles.personRowCompact,
            isMobile && styles.aiPinRowMobile,
            (hovered || pressed) && styles.rowPressed,
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
            <Ionicons name="sparkles" size={isMobile ? 16 : 20} color={BUBBLE_MINE} />
          </View>
          <View style={styles.personCopy}>
            <Text style={[styles.personName, isMobile && styles.aiPinNameMobile]} numberOfLines={1}>
              Talk to AI
            </Text>
            <Text style={styles.personSub} numberOfLines={1}>
              {isMobile ? 'New chat · charts, stock, hours' : 'Charts, maps, stock, hours, and documents'}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color="#c7c7cc" />
        </Pressable>
      ) : null;

      const peopleRows = filteredPeople.map((person) => {
        const checked = selectedIds.includes(person.id);
        return (
          <Pressable
            key={person.id}
            onPress={() => toggleSelected(person.id)}
            {...(Platform.OS === 'web' ? { className: 'cgold-dm-row' } : null)}
            style={({ hovered, pressed }) => [
              styles.personRow,
              isMobile && styles.personRowCompact,
              (hovered || pressed) && styles.rowPressed,
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
        <View style={[styles.sideEmptyWrap, isMobile && styles.inboxCenteredMobile]}>
          <View style={styles.emptyMark}>
            <Ionicons name="chatbubbles-outline" size={18} color={SECONDARY} />
          </View>
          <Text style={styles.sideEmptyTitle}>No messages yet</Text>
          <Text style={styles.sideEmpty}>Tap compose to message a person.</Text>
        </View>
      );
    }

    return filteredInbox.map((row) => {
      const selected = row.conversationId === activeId;
      const unread = row.unreadCount > 0;
      const senderName = row.lastMessageIsAssistant
        ? row.isAgent
          ? AGENT_CONVERSATION_TITLE
          : 'MyCanadaGold AI'
        : row.lastMessageSenderId === myId
          ? 'You'
          : firstNameOf((row.members || []).find((person) => person.id === row.lastMessageSenderId));
      // Same three-line shape as the Emails inbox: who, a subject-style line, then the preview.
      const preview = row.isAgent
        ? agentWorkPreview(agentBuilds[row.conversationId]) || 'New conversation'
        : row.isAi
          ? 'Charts, maps, stock, hours, and documents'
          : row.lastMessagePreview
            || (row.isTeam ? 'New team chat' : row.isGroup ? 'New group chat' : 'Start the conversation');
      const other = (row.members || []).find((person) => person.id !== myId);
      const subjectLine = row.isAgent
        ? AGENT_CONVERSATION_TITLE
        : row.isAi
          ? 'MyCanadaGold AI'
          : row.lastMessagePreview
            ? senderName || 'Teammate'
            : row.isTeam
              ? 'Team chat'
              : row.isGroup
                ? `${(row.members || []).length} people`
                : other?.teamName || other?.locationName || 'Direct message';
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
          style={({ hovered, pressed }) => [
            styles.personRow,
            selected && styles.personRowSelected,
            (hovered || pressed) && styles.rowPressed,
          ]}
          accessibilityLabel={`Conversation with ${conversationTitle(row)}`}
        >
          <ConversationAvatar conversation={row} size={isMobile ? 40 : 44} />
          <View style={styles.personCopy}>
            <View style={styles.personTop}>
              <Text
                style={[
                  styles.personName,
                  (selected || unread) && styles.personNameActive,
                  unread && styles.personNameUnread,
                ]}
                numberOfLines={1}
              >
                {conversationTitle(row)}
              </Text>
              <Text style={[styles.personTime, unread && styles.personTimeUnread]}>
                {formatInboxTime(row.lastMessageAt)}
              </Text>
            </View>
            <Text style={[styles.personSubject, unread && styles.personNameUnread]} numberOfLines={1}>
              {subjectLine}
            </Text>
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
    <View style={[styles.searchWrap, !isMobile && styles.searchWrapDesktop]}>
      <Ionicons name="search" size={isMobile ? 15 : 14} color="#8e8e93" />
      <TextInput
        style={[styles.searchInput, !isMobile && styles.searchInputDesktop]}
        value={query}
        onChangeText={setQuery}
        placeholder={composeOpen ? 'Search people' : 'Search'}
        placeholderTextColor="#8e8e93"
        autoCapitalize="none"
        autoCorrect={false}
        clearButtonMode="while-editing"
        returnKeyType="search"
      />
      {query ? (
        <Pressable onPress={() => setQuery('')} hitSlop={8} accessibilityLabel="Clear search">
          <Ionicons name="close-circle" size={16} color="#c7c7cc" />
        </Pressable>
      ) : null}
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
          paddingTop: 8,
          paddingBottom: mobileTabBarReserve() + 16,
        },
        !isMobile && {
          flexGrow: 1,
        },
      ]}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode={isMobile ? 'on-drag' : undefined}
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
          <View style={[styles.listHead, !isMobile && styles.listHeadDesktop]}>
            {searchField}
            <Pressable
              onPress={() => void openAiConversation()}
              style={({ hovered, pressed }) => [
                isMobile ? styles.listIconHit : styles.chromeCircle,
                (hovered || pressed) && (isMobile ? styles.listIconHitOn : styles.chromeCircleOn),
              ]}
              accessibilityLabel="Talk to AI"
            >
              <Ionicons name="sparkles-outline" size={isMobile ? 20 : 16} color={INK} />
            </Pressable>
            <Pressable
              onPress={openAgentConversation}
              style={({ hovered, pressed }) => [
                isMobile ? styles.listIconHit : styles.chromeCircle,
                (hovered || pressed) && (isMobile ? styles.listIconHitOn : styles.chromeCircleOn),
              ]}
              accessibilityLabel="Message the agent"
            >
              <Ionicons name="construct-outline" size={isMobile ? 20 : 16} color={INK} />
            </Pressable>
            <Pressable
              onPress={() => {
                setComposeOpen((current) => !current);
                setSelectedIds([]);
                setGroupName('');
                setQuery('');
                if (isMobile && !composeOpen) setActiveId(null);
              }}
              style={({ hovered, pressed }) => [
                isMobile ? styles.listIconHit : styles.chromeCircle,
                (hovered || pressed || composeOpen) && (isMobile ? styles.listIconHitOn : styles.chromeCircleOn),
              ]}
              accessibilityLabel={composeOpen ? 'Close compose' : 'Start a conversation'}
            >
              {composeOpen ? (
                <Ionicons name="close" size={isMobile ? 22 : 16} color={INK} />
              ) : (
                <Ionicons name="create-outline" size={isMobile ? 22 : 16} color={INK} />
              )}
            </Pressable>
          </View>
          <View style={styles.stage}>
            {inboxList}
          </View>
        </View>
      ) : null}

      {showThread ? (
        <View style={[styles.thread, isMobile && styles.canvasMobile, !isMobile && styles.threadDesktop]}>
          {threadLive && activeThread.isAi ? (
            // The tab bar floats over Messages on a phone; keep the AI composer above it.
            <View style={[styles.aiHost, isMobile && styles.aiHostMobile, !isMobile && styles.aiHostDesktop]}>
              <Suspense
                fallback={
                  <View style={styles.threadPlaceholder}>
                    <ActivityIndicator color={INK} />
                  </View>
                }
              >
                <AnalyticsAiPanel
                  embedded
                  title={AI_TITLE}
                  session={session}
                  compact={isMobile}
                  startBlank={aiStartBlank}
                  onBlankStarted={() => setAiStartBlank(false)}
                  onClose={() => setActiveId(null)}
                  onOpenCustomer={onOpenCustomer}
                  onOpenDocument={onOpenDocument}
                />
              </Suspense>
            </View>
          ) : threadLive ? (
            <>
              <View style={[styles.threadHeader, isMobile && styles.threadHeaderMobile, !isMobile && styles.threadHeaderDesktop]}>
                {isMobile && !activeThread.isAgent ? (
                  <Pressable
                    onPress={() => {
                      setActiveId(null);
                      setEmojiOpen(false);
                      setDetailsOpen(false);
                      setAddingMembers(false);
                    }}
                    style={styles.chromeCircle}
                    hitSlop={8}
                    accessibilityLabel="Back to messages"
                  >
                    <Ionicons name="chevron-back" size={16} color={INK} />
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
                    style={styles.threadHeaderAvatar}
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
                    {activeThread.isAgent ? null : (
                    <Text
                      style={[
                        styles.threadSeen,
                        !activeThread.isGroup && activeThread.other?.isOnline && styles.threadSeenLive,
                      ]}
                      numberOfLines={1}
                    >
                      {conversationSubtitle(activeThread, {
                        typingLabel: aiThinking ? 'Thinking…' : typingLabel,
                      })}
                    </Text>
                    )}
                  </Pressable>
                </View>
                {activeThread.isAgent ? (
                  <AgentPreviewTv
                    build={activeBuild}
                    onPress={() => setPreviewOpen(true)}
                    onOpenPreview={openPreviewUrl}
                  />
                ) : (
                <Pressable
                  onPress={() => void handleCallThread()}
                  style={styles.chromeCircle}
                  accessibilityLabel="Call"
                >
                  <Ionicons name="call-outline" size={16} color={INK} />
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
                  style={styles.chromeCircle}
                  accessibilityLabel="Chat details"
                >
                  <Ionicons
                    name={detailsOpen ? 'close' : 'information-circle-outline'}
                    size={16}
                    color={INK}
                  />
                </Pressable>
                {activeThread.isAgent && !isMobile ? (
                  <AgentPublishButton build={activeBuild} onPress={openPublish} busy={publishing} />
                ) : null}
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
                    contentContainerStyle={[
                      styles.threadListContent,
                      isMobile && styles.threadListContentMobile,
                      messages.length === 0 && styles.threadListEmpty,
                    ]}
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
                          <ConversationAvatar conversation={activeThread} size={44} />
                        </Pressable>
                        <Text style={styles.emptyTitle}>{conversationTitle(activeThread)}</Text>
                        <Text style={styles.emptyBody}>
                          {activeThread.isAgent
                            ? 'Describe what you want changed, or attach a screenshot. The TV up top turns green when a preview is ready to open.'
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
                              sender={sender}
                              conversation={activeThread}
                              composerRef={composerPillRef}
                              senderLabel={
                                message.isAssistant
                                  ? activeThread.isAgent || message.isAgentAck
                                    ? AGENT_CONVERSATION_TITLE
                                    : AI_TITLE
                                  : activeThread.isGroup && !mine
                                    ? firstNameOf(sender)
                                    : null
                              }
                              actionsDisabled={activeThread.isAgent}
                              menuOpen={menuMessageId === message.id}
                              onOpenMenu={(item) => setMenuMessageId(item.id)}
                              onCloseMenu={() => setMenuMessageId(null)}
                              mapsKey={mapsKey}
                              onOpenCustomer={onOpenCustomer}
                              onOpenDocument={onOpenDocument}
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
                      <View style={[styles.msgGap, styles.turnRow, styles.turnRowTheirs]}>
                        <View style={styles.turnAvatarSlot}>
                          <View style={styles.turnAvatar}>
                            <Ionicons name="sparkles" size={14} color={BUBBLE_MINE} />
                          </View>
                        </View>
                        <View>
                          <Text style={styles.senderLabel}>{AI_TITLE}</Text>
                          <View style={styles.typingRow}>
                            <TypingDots />
                          </View>
                        </View>
                      </View>
                    ) : typingNames.length > 0 ? (
                      <View style={[styles.msgGap, styles.turnRow, styles.turnRowTheirs]}>
                        <View style={styles.turnAvatarSlot} />
                        <View style={styles.typingRow}>
                          <TypingDots />
                        </View>
                      </View>
                    ) : null}
                  </ScrollView>

                  <EmojiPicker
                    visible={emojiOpen && !activeThread?.isAgent}
                    onPick={(emoji) => {
                      onChangeDraft(`${draft}${emoji}`);
                    }}
                  />

                  {!activeThread?.isAgent && showAiMention ? (
                    <View style={styles.mentionSheet}>
                      <Pressable
                        onPress={() => {
                          onChangeDraft(insertAiMention(draft));
                          setEmojiOpen(false);
                          requestAnimationFrame(() => composerInputRef.current?.focus?.());
                        }}
                        style={({ hovered, pressed }) => [
                          styles.mentionRow,
                          (hovered || pressed) && styles.mentionRowOn,
                        ]}
                        accessibilityLabel="Mention MyCanadaGold AI"
                      >
                        <View style={styles.mentionAvatar}>
                          <Ionicons name="sparkles" size={14} color={BUBBLE_MINE} />
                        </View>
                        <View style={styles.mentionCopy}>
                          <Text style={styles.mentionTitle}>MyCanadaGold AI</Text>
                          <Text style={styles.mentionSub} numberOfLines={1}>
                            Answers here so everyone in this chat can see
                          </Text>
                        </View>
                        <Text style={styles.mentionToken}>@ai</Text>
                      </Pressable>
                    </View>
                  ) : null}

                  {attaching && !activeThread?.isAgent ? (
                    <View style={styles.attachBusy}>
                      <ActivityIndicator size="small" color={SECONDARY} />
                      <Text style={styles.attachBusyText} numberOfLines={1}>
                        {attaching}
                      </Text>
                    </View>
                  ) : null}
                  {!activeThread?.isAgent ? (
                    <PendingAttachChips
                      items={pendingFiles}
                      onRemove={(id) => setPendingFiles((current) => current.filter((item) => item.id !== id))}
                    />
                  ) : null}

                  {activeThread?.isAgent && agentDraftImages.length ? (
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      style={styles.agentDraftImagesRow}
                      contentContainerStyle={styles.agentDraftImagesContent}
                    >
                      {agentDraftImages.map((image) => (
                        <View key={image.id} style={styles.agentDraftImageWrap}>
                          <Image source={{ uri: image.uri }} style={styles.agentDraftImage} />
                          <Pressable
                            onPress={() =>
                              setAgentDraftImages((current) => current.filter((row) => row.id !== image.id))
                            }
                            style={styles.agentDraftImageRemove}
                            accessibilityLabel="Remove photo"
                          >
                            <Ionicons name="close-circle" size={20} color="#fff" />
                          </Pressable>
                        </View>
                      ))}
                    </ScrollView>
                  ) : null}

                  <View style={[styles.composerWrap, isMobile && styles.composerWrapMobile]}>
                    <View ref={composerPillRef} collapsable={false} style={styles.composerPillAnchor}>
                    <Pressable
                      onHoverIn={() => setComposerHover(true)}
                      onHoverOut={() => setComposerHover(false)}
                      onPress={() => composerInputRef.current?.focus?.()}
                      style={[
                        styles.composerPill,
                        (composerHover || composerFocus) && styles.composerPillActive,
                        inputHeight > COMPOSER_LINE_HEIGHT && styles.composerPillMultiline,
                      ]}
                    >
                      {activeThread?.isAgent ? (
                        <Pressable
                          onPress={() => void handleAttachAgentPhotos()}
                          disabled={agentPhotoBusy || agentDraftImages.length >= MAX_AGENT_REQUEST_IMAGES}
                          style={({ hovered, pressed }) => [
                            styles.composerLead,
                            (hovered || pressed) && styles.composerLeadHover,
                            (agentPhotoBusy || agentDraftImages.length >= MAX_AGENT_REQUEST_IMAGES) &&
                              styles.composerLeadOff,
                          ]}
                          accessibilityLabel="Attach a photo"
                        >
                          {agentPhotoBusy ? (
                            <ActivityIndicator size="small" color={INK} />
                          ) : (
                            <Ionicons name="image-outline" size={18} color={INK} />
                          )}
                        </Pressable>
                      ) : (
                        <>
                          <Pressable
                            onPress={() => void handleAttachFiles()}
                            disabled={Boolean(attaching) || pendingFiles.length >= MAX_ATTACHMENTS}
                            style={({ hovered, pressed }) => [
                              styles.composerLead,
                              (hovered || pressed) && styles.composerLeadHover,
                              (attaching || pendingFiles.length >= MAX_ATTACHMENTS) && styles.composerLeadOff,
                            ]}
                            accessibilityLabel="Attach a photo, video, spreadsheet, PDF, or document"
                          >
                            {attaching ? (
                              <ActivityIndicator size="small" color={INK} />
                            ) : (
                              <Ionicons name="add" size={20} color={INK} />
                            )}
                          </Pressable>
                          <Pressable
                            onPress={() => {
                              onChangeDraft(insertAiMention(draft));
                              setEmojiOpen(false);
                              requestAnimationFrame(() => composerInputRef.current?.focus?.());
                            }}
                            style={({ hovered, pressed }) => [
                              styles.composerLead,
                              (hovered || pressed || mentionsAi(draft)) && styles.composerLeadHover,
                            ]}
                            accessibilityLabel="Mention MyCanadaGold AI"
                          >
                            <Ionicons
                              name="sparkles"
                              size={16}
                              color={mentionsAi(draft) ? BUBBLE_MINE : SECONDARY}
                            />
                          </Pressable>
                          <Pressable
                            onPress={() => setEmojiOpen((current) => !current)}
                            style={({ hovered, pressed }) => [
                              styles.composerLead,
                              (hovered || pressed || emojiOpen) && styles.composerLeadHover,
                            ]}
                            accessibilityLabel="Emojis"
                          >
                            <Ionicons
                              name={emojiOpen ? 'happy' : 'happy-outline'}
                              size={18}
                              color={emojiOpen ? INK : SECONDARY}
                            />
                          </Pressable>
                        </>
                      )}
                      <TextInput
                        ref={composerInputRef}
                        style={[styles.composerInput, { height: inputHeight, maxHeight: composerMaxHeight }]}
                        value={draft}
                        onChangeText={onChangeDraft}
                        placeholder={
                          activeThread?.isAgent
                            ? 'What do you want changed?'
                            : messages.length
                              ? 'Reply'
                              : `Message ${conversationTitle(activeThread)}…`
                        }
                        placeholderTextColor={SECONDARY}
                        multiline
                        maxLength={4000}
                        blurOnSubmit={false}
                        scrollEnabled={inputHeight >= composerMaxHeight}
                        onFocus={() => setComposerFocus(true)}
                        onBlur={() => setComposerFocus(false)}
                        onContentSizeChange={syncInputHeight}
                        {...Platform.select({
                          ios: { textAlignVertical: inputHeight > COMPOSER_LINE_HEIGHT ? 'top' : 'center' },
                          android: { textAlignVertical: inputHeight > COMPOSER_LINE_HEIGHT ? 'top' : 'center' },
                          default: {},
                        })}
                        onSubmitEditing={() => void handleSend()}
                        onKeyPress={submitFromKeyboard}
                      />
                      <Animated.View style={{ transform: [{ scale: sendScale }] }}>
                        <Pressable
                          onPress={handleSend}
                          disabled={
                            (!draft.trim() && !agentDraftImages.length && !pendingFiles.length) || sending
                          }
                          style={[
                            styles.composerAction,
                            draft.trim() || agentDraftImages.length || pendingFiles.length
                              ? styles.composerActionOn
                              : styles.composerActionOff,
                          ]}
                          accessibilityLabel="Send"
                        >
                          <Ionicons name="arrow-up" size={16} color="#fff" />
                        </Pressable>
                      </Animated.View>
                    </Pressable>
                    </View>
                    <Text style={styles.composerHint}>
                      {activeThread?.isAgent
                        ? 'Enter to send · Shift+Enter for a new line'
                        : 'Type @ai to ask MyCanadaGold AI · Enter to send'}
                    </Text>
                  </View>
                </>
              )}
            </>
          ) : (
            <View style={styles.threadPlaceholder}>
              <View style={styles.emptyMark}>
                <Ionicons name="chatbubbles-outline" size={18} color={INK} />
              </View>
              <Text style={styles.emptyTitle}>Direct Messages</Text>
              <Text style={styles.emptyBody}>
                Pick a conversation, or message a person.
              </Text>
            </View>
          )}
        </View>
      ) : null}
      <AgentPublishSheet
        visible={publishOpen && Boolean(activeThread?.isAgent)}
        build={activeBuild}
        isMobile={isMobile}
        onClose={() => setPublishOpen(false)}
        onConfirm={() => void handlePublish()}
        busy={publishing}
      />
      <AgentPreviewSheet
        visible={previewOpen && Boolean(activeThread?.isAgent)}
        build={activeBuild}
        isMobile={isMobile}
        onClose={() => setPreviewOpen(false)}
        onRefresh={() => void handlePreviewRefresh()}
        refreshing={previewRefreshing}
      />
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
    width: 320,
    maxWidth: 360,
    flexShrink: 0,
    position: 'relative',
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: RULE,
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
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 8,
  },
  chromeRowDesktop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexWrap: 'nowrap',
    paddingHorizontal: 12,
    paddingTop: DESKTOP_TOP_BAR_HEIGHT + 12,
  },
  chromeRowMobile: {
    zIndex: 24,
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: RULE,
  },
  listHead: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 52,
    paddingHorizontal: 8,
    paddingVertical: 6,
    gap: 4,
    flexShrink: 0,
    backgroundColor: CANVAS,
  },
  listHeadDesktop: {
    height: DESKTOP_TOP_BAR_HEIGHT,
    minHeight: DESKTOP_TOP_BAR_HEIGHT,
    paddingTop: 0,
    paddingBottom: 0,
    paddingLeft: 56,
    paddingRight: 12,
    gap: 8,
    backgroundColor: 'transparent',
  },
  listIconHit: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    borderRadius: 20,
    ...Platform.select({ web: { cursor: 'pointer' }, default: {} }),
  },
  listIconHitOn: {
    backgroundColor: 'rgba(0,0,0,0.05)',
  },
  chromeSearchChip: {
    flex: 1,
    minWidth: 0,
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
    width: '100%',
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
    flexShrink: 0,
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
    width: 32,
    height: 32,
    borderRadius: CHIP_RADIUS,
    borderWidth: 1,
    borderColor: CHIP_BORDER,
    backgroundColor: CANVAS,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    ...CHIP_SHADOW,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  chromeCircleOn: {
    backgroundColor: NAV_TAB_ACTIVE_BG,
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
    paddingHorizontal: 4,
    paddingVertical: 6,
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
    height: 32,
    paddingHorizontal: 10,
    borderRadius: CHIP_RADIUS,
    backgroundColor: INK,
    alignSelf: 'flex-start',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  createChatButtonHover: {
    backgroundColor: '#3a3a3c',
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
    height: 28,
    backgroundColor: CANVAS,
    borderRadius: CHIP_RADIUS,
    borderWidth: 1,
    borderColor: CHIP_BORDER,
    paddingLeft: 2,
    paddingRight: 8,
    alignSelf: 'flex-start',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  chipHover: {
    backgroundColor: '#f0f0f2',
  },
  chipText: {
    fontFamily,
    fontSize: 13,
    fontWeight: '400',
    color: INK,
  },
  groupNameWrap: {
    marginHorizontal: 12,
    marginBottom: 8,
    backgroundColor: CANVAS,
    borderRadius: CHIP_RADIUS,
    borderWidth: 1,
    borderColor: CHIP_BORDER,
    paddingHorizontal: 10,
    height: 32,
    justifyContent: 'center',
  },
  groupNameInput: {
    fontFamily,
    fontSize: 15,
    color: '#1d1d1f',
    padding: 0,
    outlineStyle: 'none',
  },
  searchWrap: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    height: 36,
    minHeight: 36,
    borderRadius: 999,
    backgroundColor: BUBBLE_THEM_BG,
    borderWidth: 1,
    borderColor: CHIP_BORDER,
    ...CHIP_SHADOW,
  },
  searchWrapDesktop: {
    height: 32,
    minHeight: 32,
    paddingHorizontal: 10,
    borderRadius: NAV_TAB_ACTIVE_RADIUS,
    backgroundColor: CANVAS,
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    height: 34,
    fontFamily,
    fontSize: 14,
    fontWeight: '400',
    color: INK,
    paddingVertical: 0,
    letterSpacing: -0.2,
    outlineStyle: 'none',
  },
  searchInputDesktop: {
    height: 30,
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
    fontWeight: '600',
    color: SECONDARY,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 4,
  },
  aiPinAvatar: {
    backgroundColor: BUBBLE_THEM_BG,
  },
  aiPinRowMobile: {
    minHeight: 64,
    paddingVertical: 12,
  },
  aiPinNameMobile: {
    fontWeight: '600',
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
    paddingTop: 48,
  },
  sideEmptyWrap: {
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 48,
  },
  sideEmptyTitle: {
    fontFamily,
    fontSize: 14,
    fontWeight: '500',
    color: INK,
    letterSpacing: -0.2,
    textAlign: 'center',
  },
  sideEmpty: {
    fontFamily,
    fontSize: 13,
    lineHeight: 18,
    color: SECONDARY,
    textAlign: 'center',
  },
  personRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 56,
    paddingVertical: 10,
    paddingLeft: 14,
    paddingRight: 14,
    backgroundColor: CANVAS,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: RULE,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  personRowCompact: {
    gap: 12,
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
  },
  personTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  personBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 1,
  },
  // Mirrors the Emails inbox row: name + time, a subject-style line, then the preview.
  personName: {
    flex: 1,
    fontFamily,
    fontSize: 15,
    lineHeight: 20,
    color: '#1d1d1f',
    fontWeight: '600',
    letterSpacing: -0.15,
  },
  personNameActive: {
    color: '#1d1d1f',
  },
  personNameUnread: {
    color: INK,
    fontWeight: '700',
  },
  personSubject: {
    fontFamily,
    fontSize: 14,
    lineHeight: 19,
    color: '#1d1d1f',
    marginTop: 1,
  },
  personTime: {
    fontFamily,
    fontSize: 12,
    color: SECONDARY,
  },
  personTimeUnread: {
    color: INK,
    fontWeight: '600',
  },
  personSub: {
    flex: 1,
    fontFamily,
    fontSize: 13,
    lineHeight: 18,
    color: SECONDARY,
    letterSpacing: -0.1,
  },
  personPreviewUnread: {
    color: '#3a3a3c',
  },
  unreadPill: {
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: INK,
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
  agentToolsBadge: {
    position: 'absolute',
    top: -2,
    right: -2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f2f2f7',
    borderWidth: 2,
    borderColor: '#fff',
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
    backgroundColor: CANVAS,
  },
  aiHost: {
    flex: 1,
    minHeight: 0,
  },
  aiHostMobile: {
    paddingBottom: mobileTabBarReserve(),
  },
  aiHostDesktop: {
    paddingTop: DESKTOP_TOP_BAR_HEIGHT,
  },
  threadHeader: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 48,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: CANVAS,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: RULE,
  },
  threadHeaderMobile: {
    paddingTop: 8,
    backgroundColor: CANVAS,
  },
  threadHeaderDesktop: {
    height: DESKTOP_TOP_BAR_HEIGHT,
    minHeight: DESKTOP_TOP_BAR_HEIGHT,
    paddingVertical: 0,
    paddingHorizontal: 16,
    backgroundColor: 'transparent',
    borderBottomColor: 'rgba(42,38,30,0.08)',
  },
  threadHeaderMain: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexShrink: 1,
  },
  threadHeaderAvatar: {
    flexShrink: 0,
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
    justifyContent: 'center',
    ...Platform.select({
      web: { overflow: 'hidden' },
      default: {},
    }),
  },
  threadName: {
    fontFamily,
    fontSize: 16,
    fontWeight: '500',
    color: INK,
    letterSpacing: -0.2,
  },
  threadSeen: {
    fontFamily,
    fontSize: 12,
    color: SECONDARY,
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
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 20,
  },
  threadListContentMobile: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
  },
  threadListEmpty: {
    flexGrow: 1,
  },
  threadSpinner: {
    marginTop: 48,
  },
  threadEmpty: {
    alignItems: 'center',
    paddingTop: 56,
    gap: 12,
    paddingHorizontal: 8,
  },
  threadEmptyMobile: {
    paddingTop: 28,
    gap: 10,
  },
  threadPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingTop: 56,
    paddingHorizontal: 32,
    gap: 12,
  },
  emptyMark: {
    width: 44,
    height: 44,
    borderRadius: CHIP_RADIUS,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: CANVAS,
    borderWidth: 1,
    borderColor: CHIP_BORDER,
    marginBottom: 4,
    ...CHIP_SHADOW,
  },
  emptyTitle: {
    fontFamily,
    fontSize: 18,
    fontWeight: '500',
    color: INK,
    letterSpacing: -0.3,
    textAlign: 'center',
  },
  emptyBody: {
    fontFamily,
    fontSize: 14,
    lineHeight: 21,
    color: SECONDARY,
    textAlign: 'center',
    maxWidth: 480,
  },
  emptyHint: {
    fontFamily,
    fontSize: 14,
    color: SECONDARY,
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
    marginTop: 14,
  },
  msgTight: {
    marginTop: 3,
  },
  turnRow: {
    flexDirection: 'row',
    alignSelf: 'stretch',
    width: '100%',
    gap: 8,
  },
  turnRowTheirs: {
    justifyContent: 'flex-start',
    alignItems: 'flex-end',
  },
  turnRowMine: {
    justifyContent: 'flex-end',
    alignItems: 'flex-start',
  },
  turnAvatarSlot: {
    width: 28,
    flexShrink: 0,
    // Sits under the last bubble of a cluster, so the delivery line never pushes it.
    marginBottom: 2,
  },
  turnAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: BUBBLE_THEM_BG,
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
    lineHeight: 14,
    color: SECONDARY,
    marginBottom: 3,
    marginLeft: 4,
  },
  detailsPanel: {
    flex: 1,
    minHeight: 0,
    backgroundColor: CANVAS,
  },
  detailsContent: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 32,
  },
  detailsContentMobile: {
    paddingBottom: mobileTabBarReserve() + 32,
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
    fontSize: 14,
    fontWeight: '400',
    color: INK,
    backgroundColor: CANVAS,
    borderWidth: 1,
    borderColor: CHIP_BORDER,
    borderRadius: CHIP_RADIUS,
    paddingHorizontal: 10,
    height: 32,
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
    paddingHorizontal: 15,
    paddingVertical: 10,
    maxWidth: '100%',
    ...Platform.select({
      web: { width: 'fit-content', maxWidth: '100%', overflow: 'visible' },
      default: {},
    }),
  },
  bubbleMine: {
    backgroundColor: BUBBLE_MINE,
  },
  bubbleTheirs: {
    backgroundColor: BUBBLE_THEM_BG,
  },
  bubbleHoverMine: {
    backgroundColor: '#0a6fe8',
  },
  bubbleHoverTheirs: {
    backgroundColor: '#e0e0e3',
  },
  bubbleText: {
    fontFamily,
    fontSize: 16,
    lineHeight: 22,
    color: '#1c1c1e',
    ...Platform.select({
      web: { display: 'block', overflow: 'visible' },
      default: {},
    }),
  },
  bubbleTextMine: {
    color: '#fff',
  },
  requestStatusInBubble: {
    fontFamily,
    fontSize: 12,
    lineHeight: 16,
    color: '#636366',
    marginTop: 6,
  },
  requestStatusInBubbleMine: {
    color: 'rgba(255,255,255,0.78)',
  },
  aiMention: {
    color: BUBBLE_MINE,
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
    backgroundColor: BUBBLE_THEM_BG,
    borderRadius: BUBBLE_RADIUS,
    borderBottomLeftRadius: BUBBLE_TAIL,
    paddingHorizontal: 15,
    paddingVertical: 12,
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
  messageImages: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 6,
    maxWidth: 260,
  },
  messageImage: {
    width: 120,
    height: 120,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.06)',
  },
  agentDraftImagesRow: {
    maxHeight: 92,
    marginHorizontal: 12,
    marginBottom: 6,
  },
  agentDraftImagesContent: {
    gap: 8,
    paddingHorizontal: 4,
  },
  agentDraftImageWrap: {
    position: 'relative',
  },
  agentDraftImage: {
    width: 72,
    height: 72,
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.06)',
  },
  agentDraftImageRemove: {
    position: 'absolute',
    top: -6,
    right: -6,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  turnBlock: {
    alignSelf: 'stretch',
    width: '100%',
  },
  vizBlock: {
    alignSelf: 'stretch',
    width: '100%',
    marginTop: 8,
    gap: 10,
  },
  vizSpinner: {
    marginVertical: 12,
  },
  mentionSheet: {
    marginHorizontal: 24,
    marginBottom: 8,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: RULE,
    backgroundColor: '#fff',
    overflow: 'hidden',
  },
  mentionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    ...Platform.select({ web: { cursor: 'pointer' }, default: {} }),
  },
  mentionRowOn: {
    backgroundColor: NAV_TAB_ACTIVE_BG,
  },
  mentionAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: BUBBLE_THEM_BG,
  },
  mentionCopy: {
    flex: 1,
    minWidth: 0,
  },
  mentionTitle: {
    fontFamily,
    fontSize: 14,
    fontWeight: '500',
    color: INK,
  },
  mentionSub: {
    fontFamily,
    fontSize: 12,
    color: SECONDARY,
    marginTop: 1,
  },
  mentionToken: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: BUBBLE_MINE,
  },
  attachBusy: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 24,
    paddingBottom: 6,
  },
  attachBusyText: {
    fontFamily,
    fontSize: 12,
    color: SECONDARY,
    flexShrink: 1,
  },
  attachRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    paddingHorizontal: 24,
    paddingBottom: 8,
  },
  attachRowMine: {
    justifyContent: 'flex-end',
    paddingHorizontal: 0,
    paddingBottom: 6,
  },
  attachChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    maxWidth: 260,
    paddingLeft: 6,
    paddingRight: 8,
    paddingVertical: 5,
    borderRadius: NAV_TAB_ACTIVE_RADIUS,
    borderWidth: 1,
    borderColor: CHIP_BORDER,
    backgroundColor: CANVAS,
  },
  attachChipMine: {
    borderColor: BUBBLE_MINE,
    backgroundColor: BUBBLE_MINE,
  },
  attachThumb: {
    width: 32,
    height: 32,
    borderRadius: 4,
    backgroundColor: NAV_TAB_ACTIVE_BG,
  },
  attachIcon: {
    width: 32,
    height: 32,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: NAV_TAB_ACTIVE_BG,
  },
  attachIconMine: {
    backgroundColor: '#3a3a3c',
  },
  attachCopy: {
    flexShrink: 1,
    minWidth: 0,
    gap: 1,
  },
  attachName: {
    fontFamily,
    fontSize: 12,
    fontWeight: '500',
    color: INK,
  },
  attachNameMine: {
    color: '#fff',
  },
  attachMeta: {
    fontFamily,
    fontSize: 11,
    color: SECONDARY,
  },
  attachMetaMine: {
    color: 'rgba(255,255,255,0.72)',
  },
  attachRemove: {
    marginLeft: 2,
    ...Platform.select({ web: { cursor: 'pointer' }, default: {} }),
  },
  composerWrap: {
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
    flexShrink: 0,
    paddingHorizontal: 24,
    paddingTop: 10,
    paddingBottom: Platform.select({ web: 22, ios: 28, default: 18 }),
    gap: 8,
    backgroundColor: CANVAS,
  },
  composerWrapMobile: {
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 10 + mobileTabBarReserve(),
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: RULE,
  },
  composerPillAnchor: {
    width: '100%',
  },
  composerPill: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 48,
    paddingLeft: 8,
    paddingRight: 8,
    paddingVertical: 4,
    gap: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: CHIP_BORDER,
    backgroundColor: BUBBLE_THEM_BG,
    ...COMPOSER_PILL_IDLE_SHADOW,
    ...Platform.select({
      web: { transition: 'box-shadow 180ms ease' },
      default: {},
    }),
  },
  composerPillActive: {
    ...COMPOSER_PILL_ACTIVE_SHADOW,
  },
  composerPillMultiline: {
    alignItems: 'flex-end',
    paddingVertical: 8,
  },
  composerHint: {
    fontFamily,
    fontSize: 11,
    lineHeight: 14,
    color: SECONDARY,
    textAlign: 'center',
    ...Platform.select({ web: { display: 'none' }, default: {} }),
  },
  composerLead: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: CANVAS,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: BUBBLE_THEM_BORDER,
    flexShrink: 0,
    ...Platform.select({ web: { cursor: 'pointer' }, default: {} }),
  },
  composerLeadHover: {
    backgroundColor: NAV_TAB_ACTIVE_BG,
  },
  composerLeadOff: {
    opacity: 0.4,
  },
  composerInput: {
    flex: 1,
    minWidth: 0,
    minHeight: COMPOSER_LINE_HEIGHT,
    paddingVertical: 0,
    paddingHorizontal: 4,
    margin: 0,
    backgroundColor: 'transparent',
    fontFamily,
    fontSize: 15,
    lineHeight: COMPOSER_LINE_HEIGHT,
    color: INK,
    ...Platform.select({
      web: { outlineStyle: 'none', lineHeight: `${COMPOSER_LINE_HEIGHT}px`, padding: 0, resize: 'none' },
      default: {},
    }),
  },
  composerAction: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    ...Platform.select({ web: { cursor: 'pointer' }, default: {} }),
  },
  composerActionOn: {
    backgroundColor: BUBBLE_MINE,
  },
  composerActionOff: {
    backgroundColor: '#c7c7cc',
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
