import { createElement, useEffect, useRef, useState } from 'react';
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
import { MOBILE } from '../lib/mobileUi';

const fontFamily = Platform.select({
  ios: 'Sohne',
  android: 'Sohne',
  default: 'Sohne',
});

const ACCENT = MOBILE.blue;
const TEXT = '#1d1d1f';
const SECONDARY = '#8e8e93';
const FILL = '#e8e8ed';

const PICKER_OPTIONS = {
  mediaTypes: ['images'],
  allowsEditing: false,
  quality: 0.6,
  base64: true,
};

function webcamSupported() {
  return Platform.OS === 'web' && Boolean(navigator?.mediaDevices?.getUserMedia);
}

function fromAsset(asset) {
  const mime = asset?.mimeType || 'image/jpeg';
  const uri = asset?.base64 ? `data:${mime};base64,${asset.base64}` : asset?.uri;
  return {
    id: `img-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    uri,
  };
}

function captureFrame(video) {
  if (!video || !video.videoWidth || !video.videoHeight) return null;
  const maxW = 1600;
  const scale = Math.min(1, maxW / video.videoWidth);
  const width = Math.round(video.videoWidth * scale);
  const height = Math.round(video.videoHeight * scale);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, width, height);
  return canvas.toDataURL('image/jpeg', 0.85);
}

export default function TriageCorrectionImages({
  images,
  onChange,
  readOnly = false,
  compact = false,
  hideHeading = false,
}) {
  const list = normalizeReviewImages(images);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [viewerUri, setViewerUri] = useState('');
  const [error, setError] = useState('');
  const [captureOpen, setCaptureOpen] = useState(false);
  const [cameraState, setCameraState] = useState('idle');
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

  const addDataUrl = (uri) => {
    if (!uri || !canAdd) return;
    onChange?.([...list, { id: `img-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, uri }]);
  };

  const stopStream = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  };

  const startCamera = async () => {
    if (!webcamSupported()) {
      setCameraState('unsupported');
      return;
    }
    setCameraState('requesting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraState('live');
    } catch {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        setCameraState('live');
      } catch {
        setCameraState('denied');
      }
    }
  };

  useEffect(() => {
    if (!captureOpen) {
      stopStream();
      setCameraState('idle');
      return undefined;
    }
    void startCamera();
    return () => stopStream();
  }, [captureOpen]);

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

  const takeNativePhoto = async () => {
    if (!canAdd) return;
    setError('');
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        setError('Allow camera access to capture a photo.');
        return;
      }
      const result = await ImagePicker.launchCameraAsync(PICKER_OPTIONS);
      if (result.canceled || !result.assets?.[0]) return;
      addAssets(result.assets);
    } catch (err) {
      setError(err?.message || 'Could not open the camera.');
    }
  };

  const takePhoto = () => {
    if (!canAdd) return;
    setError('');
    if (webcamSupported()) {
      setCaptureOpen(true);
      return;
    }
    void takeNativePhoto();
  };

  const captureWebcam = () => {
    if (cameraState !== 'live') return;
    const dataUrl = captureFrame(videoRef.current);
    if (!dataUrl) {
      setError('Could not capture a frame. Try again.');
      return;
    }
    addDataUrl(dataUrl);
    setCaptureOpen(false);
  };

  const closeCapture = () => {
    setCaptureOpen(false);
  };

  const removeAt = (id) => {
    onChange?.(list.filter((item) => item.id !== id));
  };

  return (
    <View style={styles.wrap}>
      {hideHeading ? null : <Text style={styles.label}>Photos</Text>}
      {hideHeading ? null : (
        <Text style={styles.hint}>
          Capture the item, tag, or receipt so the error is easy to review.
        </Text>
      )}
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
            style={[styles.captureButton, !canAdd && styles.actionDisabled]}
            onPress={takePhoto}
            disabled={!canAdd}
            accessibilityRole="button"
            accessibilityLabel="Capture photo"
          >
            <Ionicons name="camera" size={18} color={canAdd ? '#fff' : SECONDARY} />
            <Text style={[styles.captureText, !canAdd && styles.actionTextDisabled]}>Capture</Text>
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

      <Modal visible={captureOpen} transparent animationType="fade" onRequestClose={closeCapture}>
        <View style={styles.captureRoot}>
          <Pressable style={StyleSheet.absoluteFill} onPress={closeCapture} />
          <View style={styles.captureCard}>
            <View style={styles.captureHeader}>
              <Text style={styles.captureTitle}>Capture photo</Text>
              <Pressable onPress={closeCapture} hitSlop={8} accessibilityLabel="Close camera">
                <Ionicons name="close" size={22} color={TEXT} />
              </Pressable>
            </View>
            <Text style={styles.captureSub}>
              Point the camera at the item or document that shows the error.
            </Text>
            <View style={styles.previewShell}>
              {Platform.OS === 'web'
                ? createElement('video', {
                    ref: videoRef,
                    autoPlay: true,
                    muted: true,
                    playsInline: true,
                    style: {
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover',
                      backgroundColor: '#111',
                      outline: 'none',
                      border: 'none',
                    },
                  })
                : null}
              {cameraState !== 'live' ? (
                <View style={styles.overlay}>
                  <Text style={styles.overlayTitle}>
                    {cameraState === 'requesting'
                      ? 'Starting camera…'
                      : cameraState === 'denied'
                        ? 'Camera access blocked'
                        : cameraState === 'unsupported'
                          ? 'Camera unavailable'
                          : 'Camera ready'}
                  </Text>
                  <Text style={styles.overlayBody}>
                    {cameraState === 'denied'
                      ? 'Allow camera access in your browser, then try again.'
                      : cameraState === 'unsupported'
                        ? 'Open this app in a browser that can use the camera.'
                        : 'Grant permission when prompted.'}
                  </Text>
                  {cameraState === 'denied' || cameraState === 'unsupported' ? (
                    <Pressable style={styles.retry} onPress={() => void startCamera()}>
                      <Text style={styles.retryText}>Enable camera</Text>
                    </Pressable>
                  ) : null}
                </View>
              ) : null}
            </View>
            <View style={styles.captureActions}>
              <Pressable style={styles.actionButton} onPress={closeCapture}>
                <Text style={styles.actionText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.captureButton, cameraState !== 'live' && styles.actionDisabled]}
                onPress={captureWebcam}
                disabled={cameraState !== 'live'}
                accessibilityRole="button"
                accessibilityLabel="Attach captured photo"
              >
                <Ionicons name="camera" size={18} color={cameraState === 'live' ? '#fff' : SECONDARY} />
                <Text style={[styles.captureText, cameraState !== 'live' && styles.actionTextDisabled]}>
                  Attach
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

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
    backgroundColor: FILL,
    paddingHorizontal: 12,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  captureButton: {
    flex: 1,
    minWidth: 140,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 10,
    backgroundColor: ACCENT,
    paddingHorizontal: 12,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  actionDisabled: {
    backgroundColor: FILL,
    opacity: 0.55,
  },
  actionText: {
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: ACCENT,
  },
  captureText: {
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
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
  captureRoot: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    padding: 16,
  },
  captureCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    gap: 12,
    maxWidth: 520,
    width: '100%',
    alignSelf: 'center',
  },
  captureHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  captureTitle: {
    fontFamily,
    fontSize: 18,
    fontWeight: '600',
    color: TEXT,
  },
  captureSub: {
    fontFamily,
    fontSize: 14,
    color: SECONDARY,
  },
  previewShell: {
    height: 280,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#111',
    position: 'relative',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    gap: 8,
  },
  overlayTitle: {
    fontFamily,
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
    textAlign: 'center',
  },
  overlayBody: {
    fontFamily,
    fontSize: 13,
    color: '#e5e5ea',
    textAlign: 'center',
  },
  retry: {
    marginTop: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#fff',
  },
  retryText: {
    fontFamily,
    fontSize: 14,
    fontWeight: '600',
    color: ACCENT,
  },
  captureActions: {
    flexDirection: 'row',
    gap: 8,
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
