import { createElement, forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
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
import { mobileSafeBottom, useIsMobile } from '../lib/mobileUi';
import { getVideoElement, useWebcam, webcamSupported } from '../lib/webcam';

const fontFamily = Platform.select({
  ios: 'Sohne',
  android: 'Sohne',
  default: 'Sohne',
});

const ACCENT = '#1a1a1a';
const TEXT = '#1a1a1a';
const SECONDARY = '#8e8e93';
const FILL = '#f5f5f5';

const PICKER_OPTIONS = {
  mediaTypes: ['images'],
  allowsEditing: false,
  quality: 0.6,
  base64: true,
};

const CAMERA_CONSTRAINTS = [
  {
    video: {
      facingMode: { ideal: 'environment' },
      width: { ideal: 1920 },
      height: { ideal: 1080 },
    },
    audio: false,
  },
  { video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false },
];

// Phones get the device camera app (native picker, or <input capture> on mobile web).
// The in-page webcam modal is only for desktop browsers.
function prefersDeviceCamera(isMobile) {
  if (Platform.OS !== 'web') return true;
  if (isMobile) return true;
  const ua = typeof navigator !== 'undefined' ? String(navigator.userAgent || '') : '';
  return /Android|iPhone|iPad|iPod/i.test(ua) || (navigator?.maxTouchPoints || 0) > 1;
}

function fromAsset(asset) {
  const mime = asset?.mimeType || 'image/jpeg';
  const uri = asset?.base64 ? `data:${mime};base64,${asset.base64}` : asset?.uri;
  return {
    id: `img-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    uri,
  };
}

export async function captureTriagePhoto() {
  try {
    if (Platform.OS !== 'web') {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) return { error: 'Allow camera access to capture a photo.' };
    }
    const result = await ImagePicker.launchCameraAsync({
      ...PICKER_OPTIONS,
      cameraType: ImagePicker.CameraType.back,
    });
    if (result.canceled || !result.assets?.[0]) return { cancelled: true };
    const image = fromAsset(result.assets[0]);
    if (!image.uri) return { error: 'Could not read that photo.' };
    return { image };
  } catch (err) {
    return { error: err?.message || 'Could not open the camera.' };
  }
}

export async function pickTriagePhotos({ remaining = MAX_REVIEW_IMAGES } = {}) {
  try {
    if (Platform.OS !== 'web') {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) return { error: 'Allow photo access to attach an image.' };
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      ...PICKER_OPTIONS,
      allowsMultipleSelection: true,
      selectionLimit: Math.max(1, remaining),
    });
    if (result.canceled || !result.assets?.length) return { cancelled: true };
    const images = [];
    for (const asset of result.assets) {
      const image = fromAsset(asset);
      if (image.uri) images.push(image);
    }
    if (!images.length) return { error: 'Could not read those photos.' };
    return { images };
  } catch (err) {
    return { error: err?.message || 'Could not open the photo library.' };
  }
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

function TriageCorrectionImages({
  images,
  onChange,
  readOnly = false,
  compact = false,
  hideHeading = false,
  hideActions = false,
  showSourceButtons = false,
  captureButtons = false,
  pickerOnly = false,
}, ref) {
  const isMobile = useIsMobile();
  const list = normalizeReviewImages(images);
  const [viewerIndex, setViewerIndex] = useState(-1);
  const [error, setError] = useState('');
  const [sourceOpen, setSourceOpen] = useState(false);
  const [captureOpen, setCaptureOpen] = useState(false);
  const { videoRef, cameraState, startCamera, setVideoNode } = useWebcam({
    active: captureOpen,
    constraints: CAMERA_CONSTRAINTS,
  });
  const canAdd = !readOnly && list.length < MAX_REVIEW_IMAGES;

  const addDataUrl = (uri) => {
    if (!uri || !canAdd) return;
    onChange?.([...list, { id: `img-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, uri }]);
  };

  const pickFromLibrary = async () => {
    if (!canAdd) return;
    setError('');
    const result = await pickTriagePhotos({ remaining: MAX_REVIEW_IMAGES - list.length });
    if (result.error) {
      setError(result.error);
      return;
    }
    if (result.cancelled || !result.images?.length) return;
    const next = [...list];
    for (const image of result.images) {
      if (next.length >= MAX_REVIEW_IMAGES) break;
      next.push(image);
    }
    onChange?.(next);
  };

  const takeNativePhoto = async () => {
    if (!canAdd) return;
    setError('');
    const result = await captureTriagePhoto();
    if (result.error) {
      setError(result.error);
      return;
    }
    if (result.cancelled || !result.image) return;
    onChange?.([...list, result.image].slice(0, MAX_REVIEW_IMAGES));
  };

  const takePhoto = () => {
    if (!canAdd) return;
    setError('');
    if (!prefersDeviceCamera(isMobile) && webcamSupported()) {
      setCaptureOpen(true);
      void startCamera();
      return;
    }
    void takeNativePhoto();
  };

  const openAddMenu = () => {
    if (!canAdd) return;
    setError('');
    setSourceOpen(true);
  };

  const chooseCamera = () => {
    setSourceOpen(false);
    takePhoto();
  };

  const chooseFiles = () => {
    setSourceOpen(false);
    void pickFromLibrary();
  };

  const viewing = viewerIndex >= 0 && viewerIndex < list.length ? list[viewerIndex] : null;

  useEffect(() => {
    if (viewerIndex >= list.length) setViewerIndex(-1);
  }, [list.length, viewerIndex]);

  useImperativeHandle(ref, () => ({
    addImage: openAddMenu,
    takePhoto,
    pickFromLibrary,
    canAdd,
    viewAt: (index = 0) => {
      if (!list.length) return;
      const next = Math.min(Math.max(0, index), list.length - 1);
      if (!list[next]?.uri) return;
      setViewerIndex(next);
    },
  }));

  const captureWebcam = () => {
    if (cameraState !== 'live') return;
    const dataUrl = captureFrame(getVideoElement(videoRef.current));
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
    <>
    {pickerOnly ? null : (
    <View style={styles.wrap}>
      {hideHeading ? null : <Text style={styles.label}>Photos</Text>}
      {hideHeading ? null : (
        <Text style={styles.hint}>
          Capture the item, tag, or receipt so the error is easy to review.
        </Text>
      )}
      {list.length === 0 && readOnly ? (
        <Text style={styles.empty}>No photos attached</Text>
      ) : list.length > 0 || (canAdd && !showSourceButtons && !isMobile) ? (
        <View style={[styles.grid, isMobile && styles.gridMobile]}>
          {list.map((item) => (
            <View key={item.id} style={[styles.thumbWrap, isMobile && styles.thumbWrapMobile]}>
              <Pressable
                onPress={() => {
                  const index = list.findIndex((entry) => entry.id === item.id);
                  setViewerIndex(index < 0 ? 0 : index);
                }}
                accessibilityRole="button"
                accessibilityLabel="View captured photo"
              >
                <Image source={{ uri: item.uri }} style={[styles.thumb, isMobile && styles.thumbMobile]} />
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
          {canAdd && !showSourceButtons && !isMobile ? (
            <Pressable
              style={styles.addTile}
              onPress={openAddMenu}
              accessibilityRole="button"
              accessibilityLabel="Add image"
            >
              <Ionicons name="add" size={22} color={TEXT} />
              <Text style={styles.addTileText}>Add</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {showSourceButtons && !readOnly ? (
        isMobile || captureButtons ? (
          <View style={styles.mobileCaptureStack}>
            <Pressable
              style={[styles.mobileCapturePrimary, !canAdd && styles.actionDisabled]}
              onPress={takePhoto}
              disabled={!canAdd}
              accessibilityRole="button"
              accessibilityLabel="Take a photo"
            >
              <Ionicons name="camera" size={22} color={canAdd ? '#fff' : SECONDARY} />
              <Text style={[styles.mobileCapturePrimaryText, !canAdd && styles.actionTextDisabled]}>
                {captureButtons ? 'Take a photo' : 'Take Photo'}
              </Text>
            </Pressable>
            <Pressable
              style={[styles.mobileCaptureSecondary, !canAdd && styles.sourceActionDisabled]}
              onPress={chooseFiles}
              disabled={!canAdd}
              accessibilityRole="button"
              accessibilityLabel={captureButtons ? 'Upload an image' : 'Choose from photo library'}
            >
              <Ionicons name="images-outline" size={18} color={canAdd ? ACCENT : SECONDARY} />
              <Text style={[styles.mobileCaptureSecondaryText, !canAdd && styles.sourceActionTextDisabled]}>
                {captureButtons ? 'Upload an image' : 'Photo Library'}
              </Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.sourceActions}>
            <Pressable
              style={[styles.sourceAction, compact && styles.sourceActionCompact, !canAdd && styles.sourceActionDisabled]}
              onPress={takePhoto}
              disabled={!canAdd}
              accessibilityRole="button"
              accessibilityLabel="Take a photo"
            >
              <Ionicons name="camera-outline" size={18} color={canAdd ? ACCENT : SECONDARY} />
              <Text style={[styles.sourceActionText, !canAdd && styles.sourceActionTextDisabled]}>Camera</Text>
            </Pressable>
            <Pressable
              style={[styles.sourceAction, compact && styles.sourceActionCompact, !canAdd && styles.sourceActionDisabled]}
              onPress={chooseFiles}
              disabled={!canAdd}
              accessibilityRole="button"
              accessibilityLabel="Upload from files"
            >
              <Ionicons name="folder-open-outline" size={18} color={canAdd ? ACCENT : SECONDARY} />
              <Text style={[styles.sourceActionText, !canAdd && styles.sourceActionTextDisabled]}>Files</Text>
            </Pressable>
          </View>
        )
      ) : null}

      {readOnly || hideActions ? null : (
        <View style={[styles.actions, compact && styles.actionsColumn]}>
          <Pressable
            style={[styles.captureButton, !canAdd && styles.actionDisabled]}
            onPress={isMobile ? takePhoto : openAddMenu}
            disabled={!canAdd}
            accessibilityRole="button"
            accessibilityLabel="Take a photo"
          >
            <Ionicons name="camera" size={18} color={canAdd ? '#fff' : SECONDARY} />
            <Text style={[styles.captureText, !canAdd && styles.actionTextDisabled]}>
              {isMobile ? 'Take Photo' : 'Add image'}
            </Text>
          </Pressable>
        </View>
      )}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {!readOnly && list.length >= MAX_REVIEW_IMAGES ? (
        <Text style={styles.hint}>Up to {MAX_REVIEW_IMAGES} photos.</Text>
      ) : null}
    </View>
    )}
      {sourceOpen ? (
      <Modal visible transparent animationType="fade" onRequestClose={() => setSourceOpen(false)}>
        <View style={[styles.sourceRoot, isMobile && styles.sourceRootMobile]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setSourceOpen(false)} accessibilityLabel="Close" />
          <View style={[styles.sourceCard, isMobile && styles.sourceCardMobile]}>
            {isMobile ? <View style={styles.sourceGrabber} /> : null}
            <Text style={styles.sourceTitle}>{isMobile ? 'Add a photo' : 'Add image'}</Text>
            <Text style={styles.sourceSub}>
              {isMobile ? 'Take a photo of the item, tag, or receipt.' : 'Take a photo or attach a file of the item, tag, or receipt.'}
            </Text>
            <Pressable
              style={styles.sourceOption}
              onPress={chooseCamera}
              accessibilityRole="button"
              accessibilityLabel="Use camera"
            >
              <View style={styles.sourceIcon}>
                <Ionicons name="camera-outline" size={22} color={TEXT} />
              </View>
              <View style={styles.sourceCopy}>
                <Text style={styles.sourceOptionTitle}>Camera</Text>
                <Text style={styles.sourceOptionSub}>Take a new photo</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={SECONDARY} />
            </Pressable>
            <Pressable
              style={[styles.sourceOption, styles.sourceOptionLast]}
              onPress={chooseFiles}
              accessibilityRole="button"
              accessibilityLabel="Choose from files"
            >
              <View style={styles.sourceIcon}>
                <Ionicons name="folder-open-outline" size={22} color={TEXT} />
              </View>
              <View style={styles.sourceCopy}>
                <Text style={styles.sourceOptionTitle}>{isMobile ? 'Photo Library' : 'Files'}</Text>
                <Text style={styles.sourceOptionSub}>
                  {isMobile ? 'Choose from your photos' : 'Choose from photos or files'}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={SECONDARY} />
            </Pressable>
            <Pressable
              style={styles.sourceCancel}
              onPress={() => setSourceOpen(false)}
              accessibilityRole="button"
              accessibilityLabel="Cancel"
            >
              <Text style={styles.sourceCancelText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
      ) : null}

      {captureOpen ? (
      <Modal visible transparent animationType="fade" onRequestClose={closeCapture}>
        <View style={[styles.captureRoot, isMobile && styles.captureRootMobile]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={closeCapture} />
          <View style={[styles.captureCard, isMobile && styles.captureCardMobile]}>
            <View style={styles.captureHeader}>
              <Text style={styles.captureTitle}>Capture photo</Text>
              <Pressable onPress={closeCapture} hitSlop={8} accessibilityLabel="Close camera">
                <Ionicons name="close" size={22} color={TEXT} />
              </Pressable>
            </View>
            <Text style={styles.captureSub}>
              Point the camera at the item or document that shows the error.
            </Text>
            <View style={[styles.previewShell, isMobile && styles.previewShellMobile]}>
              {Platform.OS === 'web'
                ? createElement('video', {
                    ref: setVideoNode,
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
                  {cameraState !== 'live' && cameraState !== 'requesting' ? (
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
      ) : null}

      {viewing ? (
      <Modal visible transparent animationType="fade" onRequestClose={() => setViewerIndex(-1)}>
        <View style={styles.viewerRoot}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setViewerIndex(-1)} />
          <View style={styles.viewerBar}>
            <Text style={styles.viewerTitle}>
              {list.length > 1 ? `Photo ${viewerIndex + 1} of ${list.length}` : 'Captured photo'}
            </Text>
            <Pressable onPress={() => setViewerIndex(-1)} hitSlop={8} accessibilityLabel="Close photo">
              <Ionicons name="close" size={22} color="#fff" />
            </Pressable>
          </View>
          <View style={styles.viewerStage} pointerEvents="box-none">
            <Image
              source={{ uri: viewing.uri }}
              style={styles.viewerImage}
              resizeMode="contain"
              pointerEvents="none"
            />
            {list.length > 1 ? (
              <Pressable
                onPress={() => setViewerIndex((index) => Math.max(0, index - 1))}
                disabled={viewerIndex <= 0}
                style={[styles.viewerNav, styles.viewerNavLeft, viewerIndex <= 0 && styles.viewerNavOff]}
                accessibilityRole="button"
                accessibilityLabel="Previous photo"
              >
                <Ionicons name="chevron-back" size={28} color="#fff" />
              </Pressable>
            ) : null}
            {list.length > 1 ? (
              <Pressable
                onPress={() => setViewerIndex((index) => Math.min(list.length - 1, index + 1))}
                disabled={viewerIndex >= list.length - 1}
                style={[styles.viewerNav, styles.viewerNavRight, viewerIndex >= list.length - 1 && styles.viewerNavOff]}
                accessibilityRole="button"
                accessibilityLabel="Next photo"
              >
                <Ionicons name="chevron-forward" size={28} color="#fff" />
              </Pressable>
            ) : null}
          </View>
        </View>
      </Modal>
      ) : null}
    </>
  );
}

export default forwardRef(TriageCorrectionImages);

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
  addTile: {
    width: 84,
    height: 84,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#d2d2d7',
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    backgroundColor: '#fafafa',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  addTileText: {
    fontFamily,
    fontSize: 12,
    fontWeight: '600',
    color: TEXT,
  },
  gridMobile: {
    gap: 10,
  },
  thumbWrapMobile: {
    width: 104,
    height: 104,
  },
  thumbMobile: {
    width: 104,
    height: 104,
    borderRadius: 12,
  },
  mobileCaptureStack: {
    gap: 8,
  },
  mobileCapturePrimary: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 14,
    backgroundColor: ACCENT,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  mobileCapturePrimaryText: {
    fontFamily,
    fontSize: 17,
    fontWeight: '600',
    color: '#fff',
  },
  mobileCaptureSecondary: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 12,
    backgroundColor: FILL,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  mobileCaptureSecondaryText: {
    fontFamily,
    fontSize: 16,
    fontWeight: '600',
    color: ACCENT,
  },
  sourceActions: {
    flexDirection: 'row',
    gap: 8,
  },
  sourceAction: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 34,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: '#fff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(194,65,12,0.22)',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  sourceActionCompact: {
    minHeight: 44,
  },
  sourceActionDisabled: {
    opacity: 0.35,
  },
  sourceActionText: {
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: ACCENT,
  },
  sourceActionTextDisabled: {
    color: SECONDARY,
  },
  sourceRoot: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    padding: 20,
  },
  sourceRootMobile: {
    justifyContent: 'flex-end',
    padding: 0,
  },
  sourceCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    gap: 10,
    maxWidth: 420,
    width: '100%',
    alignSelf: 'center',
  },
  sourceCardMobile: {
    maxWidth: '100%',
    borderRadius: 16,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    paddingBottom: 16 + mobileSafeBottom(),
    paddingTop: 10,
  },
  sourceGrabber: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#d2d2d7',
    marginBottom: 4,
  },
  sourceTitle: {
    fontFamily,
    fontSize: 18,
    fontWeight: '600',
    color: TEXT,
    letterSpacing: -0.3,
  },
  sourceSub: {
    fontFamily,
    fontSize: 14,
    lineHeight: 19,
    color: SECONDARY,
    marginBottom: 4,
  },
  sourceOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 64,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e5ea',
    backgroundColor: '#fff',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  sourceOptionLast: {
    marginBottom: 4,
  },
  sourceIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: FILL,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sourceCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  sourceOptionTitle: {
    fontFamily,
    fontSize: 16,
    fontWeight: '600',
    color: TEXT,
  },
  sourceOptionSub: {
    fontFamily,
    fontSize: 13,
    color: SECONDARY,
  },
  sourceCancel: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: FILL,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  sourceCancelText: {
    fontFamily,
    fontSize: 16,
    fontWeight: '600',
    color: TEXT,
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
    maxHeight: '92%',
  },
  captureRootMobile: {
    justifyContent: 'flex-end',
    padding: 0,
  },
  captureCardMobile: {
    maxWidth: '100%',
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    maxHeight: '94%',
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
  previewShellMobile: {
    height: 360,
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
  viewerStage: {
    flex: 1,
    minHeight: 0,
  },
  viewerNav: {
    position: 'absolute',
    top: '46%',
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.16)',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  viewerNavLeft: {
    left: 0,
  },
  viewerNavRight: {
    right: 0,
  },
  viewerNavOff: {
    opacity: 0.35,
  },
  viewerImage: {
    width: '100%',
    height: '100%',
  },
});
