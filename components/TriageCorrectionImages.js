import { useState } from 'react';
import * as ImagePicker from 'expo-image-picker';
import {
  Image,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { MAX_REVIEW_IMAGES, normalizeReviewImages } from '../lib/triageDraft';

const fontFamily = Platform.select({
  ios: 'Sohne',
  android: 'Sohne',
  default: 'Sohne',
});

const ACCENT = '#C2410C';
const TEXT = '#1d1d1f';
const SECONDARY = '#8e8e93';
const FILL = '#e8e8ed';

const PICKER_OPTIONS = {
  mediaTypes: ['images'],
  allowsEditing: false,
  quality: 0.6,
  base64: true,
};

function fromAsset(asset) {
  const mime = asset?.mimeType || 'image/jpeg';
  const uri = asset?.base64 ? `data:${mime};base64,${asset.base64}` : asset?.uri;
  return {
    id: `img-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    uri,
  };
}

export default function TriageCorrectionImages({
  images,
  onChange,
  readOnly = false,
  compact = false,
}) {
  const list = normalizeReviewImages(images);
  const [viewerUri, setViewerUri] = useState('');
  const [error, setError] = useState('');
  const canAdd = !readOnly && list.length < MAX_REVIEW_IMAGES;

  const addAssets = (assets) => {
    const next = [...list];
    for (const asset of assets || []) {
      if (next.length >= MAX_REVIEW_IMAGES) break;
      const image = fromAsset(asset);
      if (image.uri) next.push(image);
    }
    onChange?.(next);
  };

  const pickFromLibrary = async () => {
    if (!canAdd) return;
    setError('');
    try {
      if (Platform.OS !== 'web') {
        const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!permission.granted) {
          setError('Allow photo access to attach an image.');
          return;
        }
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        ...PICKER_OPTIONS,
        allowsMultipleSelection: true,
        selectionLimit: MAX_REVIEW_IMAGES - list.length,
      });
      if (result.canceled || !result.assets?.length) return;
      addAssets(result.assets);
    } catch (err) {
      setError(err?.message || 'Could not open the photo library.');
    }
  };

  const takePhoto = async () => {
    if (!canAdd) return;
    setError('');
    try {
      if (Platform.OS !== 'web') {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) {
          setError('Allow camera access to take a photo.');
          return;
        }
      }
      const result = await ImagePicker.launchCameraAsync(PICKER_OPTIONS);
      if (result.canceled || !result.assets?.[0]) return;
      addAssets(result.assets);
    } catch (err) {
      setError(err?.message || 'Could not open the camera.');
    }
  };

  const removeAt = (id) => {
    onChange?.(list.filter((item) => item.id !== id));
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>Photos</Text>
      {list.length === 0 && readOnly ? (
        <Text style={styles.empty}>No photos attached</Text>
      ) : (
        <View style={styles.grid}>
          {list.map((item) => (
            <View key={item.id} style={styles.thumbWrap}>
              <Pressable
                onPress={() => setViewerUri(item.uri)}
                accessibilityRole="button"
                accessibilityLabel="View correction photo"
              >
                <Image source={{ uri: item.uri }} style={styles.thumb} />
              </Pressable>
              {readOnly ? null : (
                <Pressable
                  style={styles.remove}
                  onPress={() => removeAt(item.id)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Remove photo"
                >
                  <Ionicons name="close-circle" size={22} color={TEXT} />
                </Pressable>
              )}
            </View>
          ))}
        </View>
      )}

      {readOnly ? null : (
        <View style={[styles.actions, compact && styles.actionsColumn]}>
          <Pressable
            style={[styles.actionButton, !canAdd && styles.actionDisabled]}
            onPress={takePhoto}
            disabled={!canAdd}
            accessibilityRole="button"
            accessibilityLabel="Take photo"
          >
            <Ionicons name="camera-outline" size={18} color={canAdd ? ACCENT : SECONDARY} />
            <Text style={[styles.actionText, !canAdd && styles.actionTextDisabled]}>Take photo</Text>
          </Pressable>
          <Pressable
            style={[styles.actionButton, !canAdd && styles.actionDisabled]}
            onPress={pickFromLibrary}
            disabled={!canAdd}
            accessibilityRole="button"
            accessibilityLabel="Choose photo"
          >
            <Ionicons name="image-outline" size={18} color={canAdd ? ACCENT : SECONDARY} />
            <Text style={[styles.actionText, !canAdd && styles.actionTextDisabled]}>Choose photo</Text>
          </Pressable>
        </View>
      )}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {!readOnly && list.length >= MAX_REVIEW_IMAGES ? (
        <Text style={styles.hint}>Up to {MAX_REVIEW_IMAGES} photos.</Text>
      ) : null}

      <Modal visible={Boolean(viewerUri)} transparent animationType="fade" onRequestClose={() => setViewerUri('')}>
        <View style={styles.viewerRoot}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setViewerUri('')} />
          <View style={styles.viewerBar}>
            <Text style={styles.viewerTitle}>Correction photo</Text>
            <Pressable onPress={() => setViewerUri('')} hitSlop={8} accessibilityLabel="Close photo">
              <Ionicons name="close" size={22} color="#fff" />
            </Pressable>
          </View>
          {viewerUri ? (
            <Image source={{ uri: viewerUri }} style={styles.viewerImage} resizeMode="contain" />
          ) : null}
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: 8,
  },
  label: {
    fontFamily,
    fontSize: 12,
    fontWeight: '600',
    color: SECONDARY,
  },
  empty: {
    fontFamily,
    fontSize: 14,
    color: SECONDARY,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  thumbWrap: {
    position: 'relative',
    width: 84,
    height: 84,
  },
  thumb: {
    width: 84,
    height: 84,
    borderRadius: 8,
    backgroundColor: FILL,
  },
  remove: {
    position: 'absolute',
    top: -7,
    right: -7,
    backgroundColor: '#fff',
    borderRadius: 11,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  actionsColumn: {
    flexDirection: 'column',
  },
  actionButton: {
    flex: 1,
    minWidth: 140,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: ACCENT,
    backgroundColor: '#fff',
    paddingHorizontal: 12,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  actionDisabled: {
    borderColor: '#d1d1d6',
  },
  actionText: {
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: ACCENT,
  },
  actionTextDisabled: {
    color: SECONDARY,
  },
  error: {
    fontFamily,
    fontSize: 13,
    color: ACCENT,
  },
  hint: {
    fontFamily,
    fontSize: 12,
    color: SECONDARY,
  },
  viewerRoot: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.78)',
    justifyContent: 'center',
    padding: 16,
  },
  viewerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  viewerTitle: {
    fontFamily,
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  viewerImage: {
    width: '100%',
    height: '78%',
    borderRadius: 10,
  },
});
