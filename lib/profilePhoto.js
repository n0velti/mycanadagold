import { getOrCreateDm, sendDmMessage } from './messages';
import { getSupabase } from './supabase';

function asString(value) {
  if (value == null) return '';
  return String(value).trim();
}

function isMissingRelation(error) {
  const code = String(error?.code || '');
  const message = String(error?.message || '');
  if (code === '42P01' || code === 'PGRST202' || code === 'PGRST205') return true;
  return /schema cache/i.test(message) && /profile_photo_/i.test(message);
}

function describeError(error, action = 'load that portrait') {
  if (!error) return `Could not ${action}.`;
  if (isMissingRelation(error)) {
    return 'Run the profile photo SQL in Supabase, then refresh.';
  }
  return error.message || `Could not ${action}.`;
}

function throwQueryError(error, action) {
  const wrapped = new Error(describeError(error, action));
  wrapped.code = error?.code;
  wrapped.missing = isMissingRelation(error);
  throw wrapped;
}

async function currentUserId() {
  const { data } = await getSupabase().auth.getUser();
  return data?.user?.id || null;
}

export function mapPhotoOwner(row, fallback = {}) {
  const fullName =
    asString(row?.full_name || row?.fullName) || asString(fallback.name) || 'Teammate';
  return {
    id: asString(row?.id || fallback.id),
    name: fullName,
    firstName: asString(row?.first_name || row?.firstName || fallback.firstName),
    lastName: asString(row?.last_name || row?.lastName || fallback.lastName),
    avatarUrl: asString(row?.avatar_url || row?.avatarUrl || fallback.avatarUrl),
    locationName: asString(row?.location_name || row?.locationName || fallback.locationName),
  };
}

export function mapPhotoComment(row) {
  if (!row?.id) return null;
  return {
    id: row.id,
    profileId: row.profile_id || row.profileId,
    userId: row.user_id || row.userId,
    body: asString(row.body),
    authorName: asString(row.author_name || row.authorName) || 'Teammate',
    authorAvatarUrl: asString(row.author_avatar_url || row.authorAvatarUrl),
    createdAt: row.created_at || row.createdAt,
  };
}

export function formatPhotoTime(value, now = Date.now()) {
  if (!value) return '';
  const then = new Date(value).getTime();
  if (!Number.isFinite(then)) return '';
  const delta = Math.max(0, now - then);
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (delta < 45 * 1000) return 'now';
  if (delta < 50 * minute) return `${Math.max(1, Math.round(delta / minute))}m`;
  if (delta < 22 * hour) return `${Math.max(1, Math.round(delta / hour))}h`;
  if (delta < 6 * day) return `${Math.max(1, Math.round(delta / day))}d`;
  return new Date(then).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export async function fetchProfilePhoto(profileId, fallback = {}) {
  const id = asString(profileId);
  const owner = mapPhotoOwner(null, { ...fallback, id });
  if (!id) {
    return { owner, likeCount: 0, likedByMe: false, comments: [], social: false };
  }

  const supabase = getSupabase();
  const myId = await currentUserId();

  const [photoResult, likesResult, commentsResult] = await Promise.all([
    supabase.rpc('get_profile_photo', { p_profile_id: id }),
    supabase.from('profile_photo_likes').select('user_id').eq('profile_id', id),
    supabase
      .from('profile_photo_comments')
      .select('id, profile_id, user_id, body, author_name, author_avatar_url, created_at')
      .eq('profile_id', id)
      .order('created_at', { ascending: true }),
  ]);

  if (photoResult.error && !isMissingRelation(photoResult.error)) {
    throwQueryError(photoResult.error, 'load that portrait');
  }
  if (likesResult.error) {
    if (isMissingRelation(likesResult.error)) {
      return { owner, likeCount: 0, likedByMe: false, comments: [], social: false };
    }
    throwQueryError(likesResult.error, 'load likes');
  }
  if (commentsResult.error) throwQueryError(commentsResult.error, 'load comments');

  const photoRow = Array.isArray(photoResult.data) ? photoResult.data[0] : photoResult.data;
  const likes = Array.isArray(likesResult.data) ? likesResult.data : [];
  return {
    owner: mapPhotoOwner(photoRow, owner),
    likeCount: likes.length,
    likedByMe: likes.some((like) => like.user_id === myId),
    comments: (commentsResult.data || []).map(mapPhotoComment).filter(Boolean),
    social: true,
  };
}

export async function toggleProfilePhotoLike(profileId, liked) {
  const id = asString(profileId);
  if (!id) throw new Error('Missing portrait.');
  const supabase = getSupabase();
  const userId = await currentUserId();
  if (!userId) throw new Error('Sign in to like a portrait.');
  if (liked) {
    const { error } = await supabase
      .from('profile_photo_likes')
      .delete()
      .eq('profile_id', id)
      .eq('user_id', userId);
    if (error) throwQueryError(error, 'remove that like');
    return false;
  }
  const { error } = await supabase.from('profile_photo_likes').insert({
    profile_id: id,
    user_id: userId,
  });
  if (error && error.code !== '23505') throwQueryError(error, 'like that portrait');
  return true;
}

export async function addProfilePhotoComment(profileId, body) {
  const text = asString(body);
  if (!text) throw new Error('Type a comment first.');
  const id = asString(profileId);
  if (!id) throw new Error('Missing portrait.');
  const supabase = getSupabase();
  const userId = await currentUserId();
  if (!userId) throw new Error('Sign in to comment.');
  const { data, error } = await supabase
    .from('profile_photo_comments')
    .insert({
      profile_id: id,
      user_id: userId,
      body: text.slice(0, 2000),
    })
    .select('id, profile_id, user_id, body, author_name, author_avatar_url, created_at')
    .single();
  if (error) throwQueryError(error, 'post that comment');
  return mapPhotoComment(data);
}

export async function deleteProfilePhotoComment(commentId) {
  const id = asString(commentId);
  if (!id) return;
  const supabase = getSupabase();
  const { error } = await supabase.from('profile_photo_comments').delete().eq('id', id);
  if (error) throwQueryError(error, 'delete that comment');
}

export async function shareProfilePhoto({ ownerName, avatarUrl, mine, recipientIds }) {
  const ids = [...new Set((Array.isArray(recipientIds) ? recipientIds : []).map(asString).filter(Boolean))];
  if (ids.length === 0) throw new Error('Pick someone to share with.');
  const name = asString(ownerName) || 'a teammate';
  const label = mine ? 'my portrait' : `${name}'s portrait`;
  const lines = [`Shared ${label}.`];
  if (asString(avatarUrl)) lines.push(asString(avatarUrl));
  const body = lines.join('\n');
  for (const recipientId of ids) {
    const conversationId = await getOrCreateDm(recipientId);
    await sendDmMessage(conversationId, body);
  }
  return ids.length;
}

export function subscribeProfilePhoto(profileId, handlers = {}) {
  const id = asString(profileId);
  if (!id) return () => {};
  const supabase = getSupabase();
  const channel = supabase
    .channel(`profile-photo-${id}-${Date.now()}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'profile_photo_likes', filter: `profile_id=eq.${id}` },
      (payload) => handlers.onLike?.(payload),
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'profile_photo_comments', filter: `profile_id=eq.${id}` },
      (payload) => handlers.onComment?.(payload),
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}
