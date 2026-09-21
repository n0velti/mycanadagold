import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
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
  avatarColorForId,
  contactName,
  initialsFromName,
  listDmContacts,
} from '../lib/messages';
import {
  addProfilePhotoComment,
  deleteProfilePhotoComment,
  fetchProfilePhoto,
  formatPhotoTime,
  mapPhotoComment,
  shareProfilePhoto,
  subscribeProfilePhoto,
  toggleProfilePhotoLike,
} from '../lib/profilePhoto';

const fontFamily = 'Sohne';
const HEART = '#ff3040';
const BLUE = '#0095f6';
const SPLIT_BREAKPOINT = 860;

function MiniAvatar({ uri, name, id, size = 32 }) {
  const [failed, setFailed] = useState(false);
  const initials = initialsFromName(name);
  const color = avatarColorForId(id || name);
  const showImage = Boolean(uri) && !failed;

  useEffect(() => {
    setFailed(false);
  }, [uri]);

  return (
    <AvatarRing name={name} size={size}>
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        overflow: 'hidden',
        backgroundColor: showImage ? '#262626' : color,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {showImage ? (
        <Image
          source={{ uri }}
          style={{ width: size, height: size }}
          onError={() => setFailed(true)}
        />
      ) : (
        <Text style={{ fontFamily, color: '#fff', fontWeight: '600', fontSize: Math.round(size * 0.36) }}>
          {initials || '?'}
        </Text>
      )}
    </View>
    </AvatarRing>
  );
}

export default function ProfilePhotoModal({
  visible,
  onClose,
  profileId,
  name,
  avatarUrl,
  locationName,
  myId,
  myName,
  myAvatarUrl,
  canEdit = false,
  onEdit,
}) {
  const { width, height } = useWindowDimensions();
  const inset = 36;
  const split = width >= SPLIT_BREAKPOINT && height >= 560;
  const cardMaxHeight = Math.min(split ? 600 : Math.round(height * 0.8), height - inset * 2);
  const sideWidth = 360;
  const photoSize = split
    ? Math.min(cardMaxHeight, Math.max(280, width - sideWidth - inset * 2))
    : Math.min(width - inset * 2, Math.round(Math.min(cardMaxHeight * 0.46, 380)));
  const cardWidth = split
    ? Math.min(width - inset * 2, photoSize + sideWidth)
    : Math.min(420, width - inset * 2);
  const cardHeight = split ? photoSize : Math.min(cardMaxHeight, photoSize + 260);
  const commentRef = useRef(null);
  const commentsRef = useRef(null);
  const lastTapRef = useRef(0);
  const heartScale = useRef(new Animated.Value(0)).current;
  const [owner, setOwner] = useState({
    id: profileId,
    name: name || 'Teammate',
    avatarUrl: avatarUrl || '',
    locationName: locationName || '',
  });
  const [likeCount, setLikeCount] = useState(0);
  const [likedByMe, setLikedByMe] = useState(false);
  const [comments, setComments] = useState([]);
  const [social, setSocial] = useState(Boolean(profileId));
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [contacts, setContacts] = useState([]);
  const [shareQuery, setShareQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState([]);
  const [sharing, setSharing] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);
  const [failedPhoto, setFailedPhoto] = useState(false);

  const mine = Boolean(myId && profileId && myId === profileId);
  const displayName = owner.name || name || 'Teammate';
  const photoUri = owner.avatarUrl || avatarUrl || '';
  const showImage = Boolean(photoUri) && !failedPhoto;

  const load = useCallback(async () => {
    if (!profileId) {
      setSocial(false);
      setOwner({
        id: '',
        name: name || 'Teammate',
        avatarUrl: avatarUrl || '',
        locationName: locationName || '',
      });
      return;
    }
    setLoading(true);
    try {
      const next = await fetchProfilePhoto(profileId, {
        id: profileId,
        name,
        avatarUrl,
        locationName,
      });
      setOwner(next.owner);
      setLikeCount(next.likeCount);
      setLikedByMe(next.likedByMe);
      setComments(next.comments);
      setSocial(next.social);
      setError('');
    } catch (err) {
      setError(err.message || 'Could not load that portrait.');
    } finally {
      setLoading(false);
    }
  }, [profileId, name, avatarUrl, locationName]);

  useEffect(() => {
    if (!visible) {
      setDraft('');
      setShareOpen(false);
      setSelectedIds([]);
      setShareQuery('');
      setError('');
      setFailedPhoto(false);
      heartScale.setValue(0);
      return undefined;
    }
    setOwner({
      id: profileId,
      name: name || 'Teammate',
      avatarUrl: avatarUrl || '',
      locationName: locationName || '',
    });
    setFailedPhoto(false);
    void load();
    if (!profileId) return undefined;
    const unsubscribe = subscribeProfilePhoto(profileId, {
      onLike: (payload) => {
        const userId = payload.new?.user_id || payload.old?.user_id;
        const mineLike = userId === myId;
        if (payload.eventType === 'INSERT') {
          if (mineLike) setLikedByMe(true);
          else setLikeCount((count) => count + 1);
        } else if (payload.eventType === 'DELETE') {
          if (mineLike) setLikedByMe(false);
          else setLikeCount((count) => Math.max(0, count - 1));
        }
      },
      onComment: (payload) => {
        if (payload.eventType === 'INSERT') {
          const row = mapPhotoComment(payload.new);
          if (!row) return;
          setComments((current) => (current.some((item) => item.id === row.id) ? current : [...current, row]));
        } else if (payload.eventType === 'DELETE') {
          const id = payload.old?.id;
          if (id) setComments((current) => current.filter((item) => item.id !== id));
        }
      },
    });
    return unsubscribe;
  }, [visible, profileId, name, avatarUrl, locationName, load, myId, heartScale]);

  const burstHeart = () => {
    heartScale.setValue(0);
    Animated.sequence([
      Animated.timing(heartScale, {
        toValue: 1,
        duration: 180,
        easing: Easing.out(Easing.back(2)),
        useNativeDriver: true,
      }),
      Animated.delay(420),
      Animated.timing(heartScale, {
        toValue: 0,
        duration: 180,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start();
  };

  const handleToggleLike = async (forceLike = false) => {
    if (!social || !profileId) return;
    const wasLiked = likedByMe;
    if (forceLike && wasLiked) {
      burstHeart();
      return;
    }
    setLikedByMe(!wasLiked);
    setLikeCount((count) => (wasLiked ? Math.max(0, count - 1) : count + 1));
    if (!wasLiked || forceLike) burstHeart();
    try {
      await toggleProfilePhotoLike(profileId, wasLiked);
      setError('');
    } catch (err) {
      setLikedByMe(wasLiked);
      setLikeCount((count) => (wasLiked ? count + 1 : Math.max(0, count - 1)));
      setError(err.message || 'Could not like that portrait.');
    }
  };

  const handlePhotoPress = () => {
    const now = Date.now();
    if (now - lastTapRef.current < 280) {
      lastTapRef.current = 0;
      void handleToggleLike(true);
      return;
    }
    lastTapRef.current = now;
  };

  const handleSendComment = async () => {
    const text = draft.trim();
    if (!text || sending || !profileId) return;
    setSending(true);
    try {
      const row = await addProfilePhotoComment(profileId, text);
      setComments((current) => (current.some((item) => item.id === row.id) ? current : [...current, row]));
      setDraft('');
      setError('');
      requestAnimationFrame(() => commentsRef.current?.scrollToEnd?.({ animated: true }));
    } catch (err) {
      setError(err.message || 'Could not post that comment.');
    } finally {
      setSending(false);
    }
  };

  const handleDeleteComment = async (comment) => {
    if (!comment?.id) return;
    const previous = comments;
    setComments((current) => current.filter((item) => item.id !== comment.id));
    try {
      await deleteProfilePhotoComment(comment.id);
    } catch (err) {
      setComments(previous);
      setError(err.message || 'Could not delete that comment.');
    }
  };

  const openShare = async () => {
    setShareOpen(true);
    setShareBusy(true);
    try {
      const people = await listDmContacts();
      setContacts(people);
      setError('');
    } catch (err) {
      setError(err.message || 'Could not load people to share with.');
    } finally {
      setShareBusy(false);
    }
  };

  const filteredContacts = useMemo(() => {
    const q = shareQuery.trim().toLowerCase();
    return contacts.filter((person) => {
      if (!q) return true;
      return (
        contactName(person).toLowerCase().includes(q) ||
        (person.locationName || '').toLowerCase().includes(q)
      );
    });
  }, [contacts, shareQuery]);

  const handleShare = async () => {
    if (selectedIds.length === 0 || sharing) return;
    setSharing(true);
    try {
      await shareProfilePhoto({
        ownerName: displayName,
        avatarUrl: photoUri,
        mine,
        recipientIds: selectedIds,
      });
      setShareOpen(false);
      setSelectedIds([]);
      setShareQuery('');
      setError('');
    } catch (err) {
      setError(err.message || 'Could not share that portrait.');
    } finally {
      setSharing(false);
    }
  };

  const likeLabel =
    likeCount === 0 ? 'Be the first to like this' : likeCount === 1 ? '1 like' : `${likeCount.toLocaleString()} likes`;

  const actions = (
    <View style={styles.actions}>
      <View style={styles.actionRow}>
        <Pressable
          onPress={() => void handleToggleLike(false)}
          disabled={!social}
          hitSlop={8}
          accessibilityLabel={likedByMe ? 'Unlike' : 'Like'}
        >
          <Ionicons name={likedByMe ? 'heart' : 'heart-outline'} size={28} color={likedByMe ? HEART : '#f5f5f5'} />
        </Pressable>
        <Pressable
          onPress={() => commentRef.current?.focus?.()}
          disabled={!social}
          hitSlop={8}
          accessibilityLabel="Comment"
        >
          <Ionicons name="chatbubble-outline" size={26} color="#f5f5f5" />
        </Pressable>
        <Pressable onPress={() => void openShare()} disabled={!social} hitSlop={8} accessibilityLabel="Share">
          <Ionicons name="paper-plane-outline" size={26} color="#f5f5f5" />
        </Pressable>
      </View>
      <Pressable onPress={() => void handleToggleLike(false)} disabled={!social}>
        <Text style={styles.likeLabel}>{likeLabel}</Text>
      </Pressable>
    </View>
  );

  const commentsList = (
    <ScrollView
      ref={commentsRef}
      style={styles.comments}
      contentContainerStyle={styles.commentsContent}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.captionRow}>
        <MiniAvatar uri={photoUri} name={displayName} id={owner.id || profileId} size={32} />
        <View style={styles.captionCopy}>
          <Text style={styles.commentText}>
            <Text style={styles.commentName}>{displayName} </Text>
            {owner.locationName || locationName
              ? `Canada Gold portrait · ${owner.locationName || locationName}`
              : 'Canada Gold portrait'}
          </Text>
        </View>
      </View>
      {loading && comments.length === 0 ? (
        <ActivityIndicator color="#f5f5f5" style={styles.spinner} />
      ) : comments.length === 0 ? (
        <Text style={styles.emptyComments}>
          {social ? 'No comments yet. Say something nice.' : 'Comments are not available yet.'}
        </Text>
      ) : (
        comments.map((comment) => {
          const canDelete = comment.userId === myId || mine;
          return (
            <View key={comment.id} style={styles.commentRow}>
              <MiniAvatar
                uri={comment.authorAvatarUrl}
                name={comment.authorName}
                id={comment.userId}
                size={32}
              />
              <View style={styles.captionCopy}>
                <Text style={styles.commentText}>
                  <Text style={styles.commentName}>{comment.authorName} </Text>
                  {comment.body}
                </Text>
                <View style={styles.commentMeta}>
                  <Text style={styles.commentTime}>{formatPhotoTime(comment.createdAt)}</Text>
                  {canDelete ? (
                    <Pressable onPress={() => void handleDeleteComment(comment)} hitSlop={6}>
                      <Text style={styles.commentDelete}>Delete</Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>
            </View>
          );
        })
      )}
    </ScrollView>
  );

  const composer = (
    <View style={styles.composer}>
      <MiniAvatar uri={myAvatarUrl} name={myName || 'You'} id={myId} size={28} />
      <TextInput
        ref={commentRef}
        style={styles.input}
        value={draft}
        onChangeText={setDraft}
        placeholder={social ? 'Add a comment…' : 'Comments unavailable'}
        placeholderTextColor="#737373"
        editable={social && !sending}
        maxLength={2000}
        returnKeyType="send"
        onSubmitEditing={() => void handleSendComment()}
      />
      <Pressable onPress={() => void handleSendComment()} disabled={!draft.trim() || sending || !social} hitSlop={6}>
        {sending ? (
          <ActivityIndicator size="small" color={BLUE} />
        ) : (
          <Text style={[styles.postText, (!draft.trim() || !social) && styles.postTextDisabled]}>Post</Text>
        )}
      </Pressable>
    </View>
  );

  const photo = (
    <Pressable
      onPress={handlePhotoPress}
      style={[
        styles.photoStage,
        split ? { width: photoSize, height: photoSize } : { height: photoSize, width: '100%' },
      ]}
      accessibilityLabel="Portrait"
    >
      {showImage ? (
        <Image
          source={{ uri: photoUri }}
          style={styles.photo}
          resizeMode="contain"
          onError={() => setFailedPhoto(true)}
        />
      ) : (
        <View style={styles.photoFallback}>
          <MiniAvatar uri="" name={displayName} id={owner.id || profileId} size={Math.min(160, Math.round(photoSize * 0.42))} />
          <Text style={styles.photoFallbackName}>{displayName}</Text>
          {canEdit ? (
            <Pressable onPress={onEdit} style={styles.addPhotoButton}>
              <Text style={styles.addPhotoText}>Add a portrait</Text>
            </Pressable>
          ) : (
            <Text style={styles.photoFallbackHint}>No portrait yet</Text>
          )}
        </View>
      )}
      <Animated.View
        pointerEvents="none"
        style={[
          styles.burstHeart,
          {
            opacity: heartScale,
            transform: [{ scale: heartScale.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) }],
          },
        ]}
      >
        <Ionicons name="heart" size={88} color="#fff" />
      </Animated.View>
    </Pressable>
  );

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.root}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable
          style={styles.backdrop}
          onPress={onClose}
          accessibilityLabel="Close"
          accessibilityRole="button"
        />
        <Pressable
          onPress={onClose}
          style={styles.overlayClose}
          hitSlop={10}
          accessibilityLabel="Close"
        >
          <Ionicons name="close" size={28} color="#f5f5f5" />
        </Pressable>
        <View
          style={[
            styles.shell,
            {
              width: cardWidth,
              maxHeight: cardMaxHeight,
              height: cardHeight,
            },
          ]}
        >
          {split ? null : (
            <View style={styles.topBar}>
              <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="Close">
                <Ionicons name="close" size={22} color="#f5f5f5" />
              </Pressable>
              <Text style={styles.topTitle} numberOfLines={1}>
                {displayName}
              </Text>
              {canEdit ? (
                <Pressable onPress={onEdit} hitSlop={10} accessibilityLabel="Edit portrait">
                  <Ionicons name="pencil" size={18} color="#f5f5f5" />
                </Pressable>
              ) : (
                <View style={{ width: 22 }} />
              )}
            </View>
          )}

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <View style={[styles.body, split && styles.bodySplit, split && { height: photoSize }]}>
            {photo}
            <View style={[styles.side, split && styles.sideSplit]}>
              {split ? (
                <View style={styles.sideHeader}>
                  <MiniAvatar uri={photoUri} name={displayName} id={owner.id || profileId} size={36} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.sideName} numberOfLines={1}>
                      {displayName}
                    </Text>
                    {owner.locationName || locationName ? (
                      <Text style={styles.sideMeta} numberOfLines={1}>
                        {owner.locationName || locationName}
                      </Text>
                    ) : null}
                  </View>
                  {canEdit ? (
                    <Pressable onPress={onEdit} hitSlop={10} accessibilityLabel="Edit portrait">
                      <Ionicons name="pencil" size={18} color="#f5f5f5" />
                    </Pressable>
                  ) : null}
                </View>
              ) : null}
              {actions}
              {commentsList}
              {composer}
            </View>
          </View>
        </View>

        {shareOpen ? (
          <View style={styles.shareOverlay}>
            <Pressable style={styles.shareBackdrop} onPress={() => setShareOpen(false)} />
            <View style={[styles.shareSheet, { width: Math.min(420, width - 24) }]}>
              <View style={styles.shareHandle} />
              <Text style={styles.shareTitle}>Share</Text>
              <View style={styles.shareSearch}>
                <Ionicons name="search" size={15} color="#8e8e93" />
                <TextInput
                  style={styles.shareInput}
                  value={shareQuery}
                  onChangeText={setShareQuery}
                  placeholder="Search people"
                  placeholderTextColor="#8e8e93"
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>
              <ScrollView style={styles.shareList} keyboardShouldPersistTaps="handled">
                {shareBusy ? (
                  <ActivityIndicator color="#1d1d1f" style={styles.spinner} />
                ) : filteredContacts.length === 0 ? (
                  <Text style={styles.shareEmpty}>No teammates to share with.</Text>
                ) : (
                  filteredContacts.map((person) => {
                    const selected = selectedIds.includes(person.id);
                    const label = contactName(person);
                    return (
                      <Pressable
                        key={person.id}
                        onPress={() =>
                          setSelectedIds((current) =>
                            selected ? current.filter((id) => id !== person.id) : [...current, person.id],
                          )
                        }
                        style={styles.shareRow}
                      >
                        <MiniAvatar uri={person.avatarUrl} name={label} id={person.id} size={40} />
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text style={styles.shareName} numberOfLines={1}>
                            {label}
                          </Text>
                          {person.locationName ? (
                            <Text style={styles.shareMeta} numberOfLines={1}>
                              {person.locationName}
                            </Text>
                          ) : null}
                        </View>
                        <Ionicons
                          name={selected ? 'checkmark-circle' : 'ellipse-outline'}
                          size={22}
                          color={selected ? BLUE : '#c7c7cc'}
                        />
                      </Pressable>
                    );
                  })
                )}
              </ScrollView>
              <Pressable
                onPress={() => void handleShare()}
                disabled={selectedIds.length === 0 || sharing}
                style={[styles.shareSend, (selectedIds.length === 0 || sharing) && styles.shareSendDisabled]}
              >
                {sharing ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.shareSendText}>
                    {selectedIds.length <= 1 ? 'Send' : `Send to ${selectedIds.length}`}
                  </Text>
                )}
              </Pressable>
            </View>
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.62)',
  },
  overlayClose: {
    position: 'absolute',
    top: 16,
    left: 16,
    zIndex: 2,
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shell: {
    backgroundColor: '#000',
    borderRadius: 12,
    overflow: 'hidden',
    minHeight: 0,
    zIndex: 1,
    ...Platform.select({
      web: {
        boxShadow: '0 24px 80px rgba(0,0,0,0.45)',
      },
      default: {
        elevation: 12,
        shadowColor: '#000',
        shadowOpacity: 0.4,
        shadowRadius: 24,
        shadowOffset: { width: 0, height: 12 },
      },
    }),
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  topTitle: {
    fontFamily,
    fontSize: 16,
    fontWeight: '600',
    color: '#f5f5f5',
    flex: 1,
    textAlign: 'center',
    marginHorizontal: 12,
  },
  error: {
    fontFamily,
    fontSize: 13,
    color: '#ff8a80',
    textAlign: 'center',
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  body: {
    flex: 1,
    minHeight: 0,
  },
  bodySplit: {
    flexDirection: 'row',
    flex: 1,
    minHeight: 0,
  },
  photoStage: {
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  photo: {
    width: '100%',
    height: '100%',
  },
  photoFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 24,
  },
  photoFallbackName: {
    fontFamily,
    fontSize: 20,
    fontWeight: '600',
    color: '#f5f5f5',
  },
  photoFallbackHint: {
    fontFamily,
    fontSize: 14,
    color: '#a8a8a8',
  },
  addPhotoButton: {
    marginTop: 4,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#262626',
  },
  addPhotoText: {
    fontFamily,
    fontSize: 14,
    fontWeight: '600',
    color: '#f5f5f5',
  },
  burstHeart: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  side: {
    flex: 1,
    minHeight: 0,
    backgroundColor: '#000',
  },
  sideSplit: {
    width: 360,
    flex: 1,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: '#262626',
  },
  sideHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#262626',
  },
  sideName: {
    fontFamily,
    fontSize: 14,
    fontWeight: '700',
    color: '#f5f5f5',
  },
  sideMeta: {
    fontFamily,
    fontSize: 12,
    color: '#a8a8a8',
    marginTop: 1,
  },
  actions: {
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 4,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    marginBottom: 8,
  },
  likeLabel: {
    fontFamily,
    fontSize: 14,
    fontWeight: '600',
    color: '#f5f5f5',
  },
  comments: {
    flex: 1,
    minHeight: 0,
  },
  commentsContent: {
    paddingHorizontal: 14,
    paddingBottom: 12,
    gap: 14,
  },
  captionRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingTop: 8,
  },
  commentRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  captionCopy: {
    flex: 1,
    minWidth: 0,
    paddingTop: 2,
  },
  commentText: {
    fontFamily,
    fontSize: 14,
    color: '#f5f5f5',
    lineHeight: 19,
  },
  commentName: {
    fontFamily,
    fontWeight: '700',
    color: '#f5f5f5',
  },
  commentMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 4,
  },
  commentTime: {
    fontFamily,
    fontSize: 12,
    color: '#a8a8a8',
  },
  commentDelete: {
    fontFamily,
    fontSize: 12,
    fontWeight: '600',
    color: '#a8a8a8',
  },
  emptyComments: {
    fontFamily,
    fontSize: 14,
    color: '#a8a8a8',
    paddingVertical: 12,
  },
  spinner: {
    marginVertical: 18,
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#262626',
  },
  input: {
    flex: 1,
    fontFamily,
    fontSize: 14,
    color: '#f5f5f5',
    paddingVertical: 8,
    ...Platform.select({
      web: { outlineStyle: 'none' },
      default: {},
    }),
  },
  postText: {
    fontFamily,
    fontSize: 14,
    fontWeight: '700',
    color: BLUE,
  },
  postTextDisabled: {
    color: '#0b4a78',
  },
  shareOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingBottom: 18,
  },
  shareBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  shareSheet: {
    backgroundColor: '#fff',
    borderRadius: 18,
    maxHeight: '78%',
    paddingBottom: 16,
    overflow: 'hidden',
  },
  shareHandle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#d1d1d6',
    marginTop: 8,
    marginBottom: 8,
  },
  shareTitle: {
    fontFamily,
    fontSize: 16,
    fontWeight: '700',
    color: '#1d1d1f',
    textAlign: 'center',
    marginBottom: 10,
  },
  shareSearch: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 14,
    marginBottom: 8,
    backgroundColor: '#f2f2f7',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  shareInput: {
    flex: 1,
    fontFamily,
    fontSize: 15,
    color: '#1d1d1f',
    ...Platform.select({
      web: { outlineStyle: 'none' },
      default: {},
    }),
  },
  shareList: {
    maxHeight: 320,
    minHeight: 120,
  },
  shareRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  shareName: {
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: '#1d1d1f',
  },
  shareMeta: {
    fontFamily,
    fontSize: 12,
    color: '#8e8e93',
    marginTop: 1,
  },
  shareEmpty: {
    fontFamily,
    fontSize: 14,
    color: '#8e8e93',
    textAlign: 'center',
    paddingVertical: 24,
  },
  shareSend: {
    marginHorizontal: 14,
    marginTop: 10,
    backgroundColor: BLUE,
    borderRadius: 10,
    minHeight: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shareSendDisabled: {
    opacity: 0.45,
  },
  shareSendText: {
    fontFamily,
    fontSize: 15,
    fontWeight: '700',
    color: '#fff',
  },
});
