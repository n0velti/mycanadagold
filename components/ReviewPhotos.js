import { useEffect, useState } from 'react';
import {
  Image,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { googleReviewPermalink, reviewPhotoUrls } from '../lib/googleReviews';
import { FONT } from '../lib/typography';

function openUrl(url) {
  const href = String(url || '').trim();
  if (!href) return;
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    window.open(href, '_blank', 'noopener,noreferrer');
    return;
  }
  void Linking.openURL(href);
}

export function openReviewPhoto(review, storeName) {
  const urls = reviewPhotoUrls(review);
  if (urls[0]) {
    openUrl(urls[0]);
    return;
  }
  const permalink = googleReviewPermalink(review, storeName);
  if (permalink) openUrl(permalink);
}

export default function ReviewPhotos({ review, storeName, chipLabel, chipStyle, chipTextStyle }) {
  const urls = reviewPhotoUrls(review);
  const permalink = googleReviewPermalink(review, storeName);
  const hasPhotos = Boolean(review?.hasPhotos || Number(review?.photoCount) > 0 || urls.length);
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const [failed, setFailed] = useState({});

  useEffect(() => {
    setFailed({});
    setIndex(0);
    setOpen(false);
  }, [review?.id]);

  if (!hasPhotos) return null;

  const visibleUrls = urls.filter((url) => !failed[url]);
  const current = visibleUrls[Math.min(index, Math.max(0, visibleUrls.length - 1))] || '';
  const hasMany = visibleUrls.length > 1;
  const count = Math.max(Number(review?.photoCount) || 0, urls.length, visibleUrls.length);
  const label =
    chipLabel ||
    (visibleUrls.length
      ? `View photo${count > 1 ? `s · ${count}` : ''}`
      : permalink
        ? 'View photo on Google'
        : 'Photo');

  const openPhotos = (start = 0) => {
    if (visibleUrls.length) {
      setIndex(Math.max(0, Math.min(start, visibleUrls.length - 1)));
      setOpen(true);
      return;
    }
    if (permalink) openUrl(permalink);
  };

  const chip = (
    <Pressable
      onPress={() => openPhotos(0)}
      accessibilityRole="link"
      accessibilityLabel={label}
      style={({ pressed, hovered }) => [styles.chipHit, (pressed || hovered) && styles.chipHover]}
      {...(Platform.OS === 'web' ? { className: 'cgold-triage-btn' } : null)}
    >
      <Text style={chipTextStyle || chipStyle}>{label}</Text>
    </Pressable>
  );

  return (
    <>
      {visibleUrls.length ? (
        <ScrollView
          horizontal
          nestedScrollEnabled
          showsHorizontalScrollIndicator={false}
          style={styles.strip}
          contentContainerStyle={styles.stripContent}
        >
          {visibleUrls.map((url, photoIndex) => (
            <Pressable
              key={url}
              onPress={() => openPhotos(photoIndex)}
              accessibilityRole="button"
              accessibilityLabel={`View photo ${photoIndex + 1} of ${visibleUrls.length}`}
              style={({ pressed, hovered }) => [styles.thumbPress, (pressed || hovered) && styles.chipHover]}
              {...(Platform.OS === 'web' ? { className: 'cgold-triage-btn' } : null)}
            >
              <Image
                source={{ uri: url }}
                style={styles.thumb}
                resizeMode="cover"
                onError={() => setFailed((currentFailed) => ({ ...currentFailed, [url]: true }))}
                {...(Platform.OS === 'web' ? { referrerPolicy: 'no-referrer' } : null)}
              />
            </Pressable>
          ))}
        </ScrollView>
      ) : null}
      {chipStyle || chipTextStyle || chipLabel ? chip : (
        <Pressable
          onPress={() => openPhotos(0)}
          accessibilityRole="link"
          accessibilityLabel={label}
          style={({ pressed, hovered }) => [styles.linkRow, (pressed || hovered) && styles.chipHover]}
          {...(Platform.OS === 'web' ? { className: 'cgold-triage-btn' } : null)}
        >
          <Ionicons name="image-outline" size={14} color="#1D4ED8" />
          <Text style={styles.linkText}>{label}</Text>
          <Ionicons name="open-outline" size={13} color="#1D4ED8" />
        </Pressable>
      )}
      {open && current ? (
        <Modal visible transparent animationType="fade" onRequestClose={() => setOpen(false)}>
          <View style={styles.viewerRoot}>
            <Pressable style={StyleSheet.absoluteFill} onPress={() => setOpen(false)} />
            <View style={styles.viewerSheet} pointerEvents="box-none">
              <View style={styles.viewerBar}>
                <Text style={styles.viewerTitle} numberOfLines={1}>
                  {review?.author ? `${review.author}` : 'Review photo'}
                  {hasMany ? `  ${index + 1}/${visibleUrls.length}` : ''}
                </Text>
                <Pressable
                  onPress={() => openUrl(current)}
                  hitSlop={8}
                  accessibilityRole="link"
                  accessibilityLabel="Open photo in a new tab"
                  style={styles.viewerOpen}
                >
                  <Ionicons name="open-outline" size={16} color="#1d1d1f" />
                </Pressable>
                <Pressable onPress={() => setOpen(false)} hitSlop={8} accessibilityLabel="Close photo">
                  <Ionicons name="close" size={20} color="#1d1d1f" />
                </Pressable>
              </View>
              <Image
                source={{ uri: current }}
                style={styles.viewerImage}
                resizeMode="contain"
                {...(Platform.OS === 'web' ? { referrerPolicy: 'no-referrer' } : null)}
              />
              {hasMany ? (
                <View style={styles.viewerNav} pointerEvents="box-none">
                  <Pressable
                    onPress={() =>
                      setIndex((currentIndex) => (currentIndex - 1 + visibleUrls.length) % visibleUrls.length)
                    }
                    style={styles.viewerNavBtn}
                    accessibilityLabel="Previous photo"
                  >
                    <Ionicons name="chevron-back" size={20} color="#fff" />
                  </Pressable>
                  <Pressable
                    onPress={() => setIndex((currentIndex) => (currentIndex + 1) % visibleUrls.length)}
                    style={styles.viewerNavBtn}
                    accessibilityLabel="Next photo"
                  >
                    <Ionicons name="chevron-forward" size={20} color="#fff" />
                  </Pressable>
                </View>
              ) : null}
              <Pressable
                onPress={() => openUrl(current)}
                accessibilityRole="link"
                accessibilityLabel="Open photo"
                style={styles.viewerLink}
              >
                <Text style={styles.viewerLinkText}>Open photo</Text>
              </Pressable>
            </View>
          </View>
        </Modal>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  strip: {
    marginTop: 2,
    marginBottom: 2,
  },
  stripContent: {
    gap: 8,
    paddingVertical: 2,
  },
  thumbPress: {
    width: 72,
    height: 72,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: '#e8e8ed',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  thumb: {
    width: 72,
    height: 72,
  },
  chipHit: {
    alignSelf: 'flex-start',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  chipHover: {
    opacity: 0.78,
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    marginTop: 2,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  linkText: {
    fontFamily: FONT,
    fontSize: 13,
    fontWeight: '600',
    color: '#1D4ED8',
    textDecorationLine: 'underline',
  },
  viewerRoot: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  viewerSheet: {
    width: '100%',
    maxWidth: 760,
    maxHeight: '90%',
    backgroundColor: '#111',
    borderRadius: 16,
    overflow: 'hidden',
  },
  viewerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: '#fff',
  },
  viewerTitle: {
    fontFamily: FONT,
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: '#1d1d1f',
  },
  viewerOpen: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewerImage: {
    width: '100%',
    height: 460,
    backgroundColor: '#111',
  },
  viewerNav: {
    ...StyleSheet.absoluteFillObject,
    top: 52,
    bottom: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
  },
  viewerNavBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  viewerLink: {
    paddingVertical: 10,
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  viewerLinkText: {
    fontFamily: FONT,
    fontSize: 13,
    fontWeight: '600',
    color: '#1D4ED8',
  },
});
