import { createElement, useEffect, useRef, useState } from 'react';
import * as ImagePicker from 'expo-image-picker';
import {
  ActivityIndicator,
  Image,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { capturePageUrl, qrDataUrl } from '../lib/qrCode';
import {
  createCaptureSession,
  subscribeCaptureSession,
  uploadLinePhoto,
} from '../lib/tradePhotos';
import { getVideoElement, useWebcam, webcamSupported } from '../lib/webcam';

const fontFamily = Platform.select({
  ios: 'Sohne',
  android: 'Sohne',
  default: 'Sohne',
});

const PICKER_OPTIONS = {
  mediaTypes: ['images'],
  allowsEditing: false,
  quality: 0.7,
  base64: true,
};

const CAMERA_CONSTRAINTS = [
  {
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
    audio: false,
  },
  { video: true, audio: false },
];

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

function fromPickerAsset(asset) {
  const mime = asset?.mimeType || 'image/jpeg';
  const uri = asset?.base64 ? `data:${mime};base64,${asset.base64}` : asset?.uri;
  return { uri, mimeType: mime };
}

export default function LinePhotoModal({ visible, line, session, onClose, onSave }) {
  const [step, setStep] = useState('sheet');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [qrUri, setQrUri] = useState('');
  const [qrLink, setQrLink] = useState('');
  const [qrFailed, setQrFailed] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const { videoRef, cameraState, startCamera, stopStream, setVideoNode } = useWebcam({
    active: visible && step === 'camera',
    autoStart: true,
    constraints: CAMERA_CONSTRAINTS,
  });
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;

  useEffect(() => {
    if (!visible) {
      stopStream();
      setStep('sheet');
      setBusy(false);
      setError('');
      setQrUri('');
      setQrLink('');
      setQrFailed(false);
      setWaiting(false);
    }
  }, [stopStream, visible]);

  useEffect(() => {
    if (!visible || !line?.id) return undefined;
    let cancelled = false;
    let unsubscribe = () => {};
    const userId = session?.supabaseUserId || session?.profile?.id || '';
    (async () => {
      try {
        const next = await createCaptureSession({
          lineId: line.id,
          itemName: line.name || '',
          userId,
        });
        if (cancelled || !next?.token) return;
        const link = capturePageUrl(next.token);
        const image = await qrDataUrl(link);
        if (cancelled) return;
        setQrLink(link);
        setQrUri(image);
        setQrFailed(!image);
        setWaiting(true);
        unsubscribe = subscribeCaptureSession(next.id, (photoUrl) => {
          onSaveRef.current?.(photoUrl);
          setWaiting(false);
        });
      } catch {
        if (!cancelled) {
          setQrLink('');
          setQrUri('');
          setQrFailed(true);
          setWaiting(false);
        }
      }
    })();
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [line?.id, line?.name, session, visible]);

  const close = () => {
    if (busy) return;
    stopStream();
    onClose?.();
  };

  const applyPhoto = async (asset) => {
    if (!asset?.uri || busy) return;
    setBusy(true);
    setError('');
    try {
      const userId = session?.supabaseUserId || session?.profile?.id || '';
      try {
        const url = await uploadLinePhoto(asset, line?.id, userId);
        onSave?.(url);
      } catch {
        onSave?.(asset.uri);
      }
      stopStream();
      setStep('sheet');
    } catch (err) {
      setError(err?.message || 'Could not attach that photo.');
    } finally {
      setBusy(false);
    }
  };

  const pickFromLibrary = async () => {
    setError('');
    try {
      if (Platform.OS !== 'web') {
        const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!permission.granted) {
          setError('Allow photo access to attach an image.');
          return;
        }
      }
      const result = await ImagePicker.launchImageLibraryAsync(PICKER_OPTIONS);
      if (result.canceled || !result.assets?.[0]) return;
      await applyPhoto(fromPickerAsset(result.assets[0]));
    } catch (err) {
      setError(err?.message || 'Could not open the photo library.');
    }
  };

  const takeNativePhoto = async () => {
    setError('');
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        setError('Allow camera access to take a photo.');
        return;
      }
      const result = await ImagePicker.launchCameraAsync(PICKER_OPTIONS);
      if (result.canceled || !result.assets?.[0]) return;
      await applyPhoto(fromPickerAsset(result.assets[0]));
    } catch (err) {
      setError(err?.message || 'Could not open the camera.');
    }
  };

  const takePhoto = () => {
    setError('');
    if (webcamSupported()) {
      setStep('camera');
      void startCamera();
      return;
    }
    void takeNativePhoto();
  };

  const captureWebcam = () => {
    if (cameraState !== 'live') return;
    const dataUrl = captureFrame(getVideoElement(videoRef.current));
    if (!dataUrl) {
      setError('Could not capture a frame. Try again.');
      return;
    }
    void applyPhoto({ uri: dataUrl, mimeType: 'image/jpeg' });
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} />
        <View style={styles.sheet} accessibilityViewIsModal>
          <View style={styles.header}>
            <View style={styles.headerCopy}>
              <Text style={styles.title}>Item photo</Text>
              <Text style={styles.meta} numberOfLines={1}>
                {line?.name || 'Line item'}
              </Text>
            </View>
            <Pressable onPress={close} hitSlop={8} accessibilityLabel="Done">
              <Text style={styles.done}>Done</Text>
            </Pressable>
          </View>

          {step === 'camera' ? (
            <View style={styles.body}>
              <View style={styles.previewShell}>
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
                    <Text style={styles.overlayText}>
                      {cameraState === 'denied' ? 'Camera access blocked' : 'Starting camera…'}
                    </Text>
                  </View>
                ) : null}
              </View>
              {error ? <Text style={styles.error}>{error}</Text> : null}
              <View style={styles.actions}>
                <Pressable onPress={() => { stopStream(); setStep('sheet'); }} hitSlop={8}>
                  <Text style={styles.muted}>Cancel</Text>
                </Pressable>
                <Pressable onPress={captureWebcam} disabled={busy || cameraState !== 'live'} hitSlop={8}>
                  {busy ? <ActivityIndicator color="#1F8A4E" /> : <Text style={styles.action}>Capture</Text>}
                </Pressable>
              </View>
            </View>
          ) : (
            <View style={styles.body}>
              {line?.imageUrl ? (
                <Image source={{ uri: line.imageUrl }} style={styles.preview} resizeMode="cover" />
              ) : (
                <View style={styles.previewEmpty}>
                  <Ionicons name="image-outline" size={28} color="#8e8e93" />
                  <Text style={styles.previewHint}>No photo yet</Text>
                </View>
              )}

              <Text style={styles.section}>This computer</Text>
              <Pressable style={styles.choice} onPress={takePhoto} disabled={busy}>
                <Ionicons name="camera-outline" size={18} color="#1d1d1f" />
                <Text style={styles.choiceLabel}>Take a photo</Text>
              </Pressable>
              <Pressable style={styles.choice} onPress={() => void pickFromLibrary()} disabled={busy}>
                <Ionicons name="folder-outline" size={18} color="#1d1d1f" />
                <Text style={styles.choiceLabel}>Choose a file</Text>
              </Pressable>

              <Text style={styles.section}>Phone</Text>
              <View style={styles.qrCard}>
                {qrUri ? (
                  <Image source={{ uri: qrUri }} style={styles.qr} />
                ) : (
                  <View style={styles.qrPlaceholder}>
                    {qrFailed ? (
                      <Text style={styles.qrHint}>
                        Phone capture needs a network connection. You can still add a photo from this computer.
                      </Text>
                    ) : (
                      <ActivityIndicator color="#1F8A4E" />
                    )}
                  </View>
                )}
                <Text style={styles.qrHint}>
                  Scan this QR code. It opens the camera on your phone — snap the item and it
                  attaches to this line.
                </Text>
                {waiting ? <Text style={styles.waiting}>Waiting for phone photo…</Text> : null}
                {qrLink ? (
                  <Text style={styles.qrLink} numberOfLines={2} selectable>
                    {qrLink}
                  </Text>
                ) : null}
              </View>

              {line?.imageUrl ? (
                <Pressable
                  onPress={() => onSave?.('')}
                  hitSlop={8}
                  style={styles.remove}
                  accessibilityLabel="Remove photo"
                >
                  <Text style={styles.removeText}>Remove photo</Text>
                </Pressable>
              ) : null}
              {error ? <Text style={styles.error}>{error}</Text> : null}
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  sheet: {
    width: '100%',
    maxWidth: 420,
    maxHeight: '90%',
    borderRadius: 12,
    backgroundColor: '#fff',
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e5ea',
    ...Platform.select({
      web: { boxShadow: '0 12px 32px rgba(0,0,0,0.10)' },
      default: {},
    }),
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ececef',
  },
  headerCopy: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontFamily,
    fontSize: 17,
    fontWeight: '600',
    color: '#1d1d1f',
    letterSpacing: -0.3,
  },
  meta: {
    fontFamily,
    fontSize: 12,
    color: '#8e8e93',
    marginTop: 2,
  },
  done: {
    fontFamily,
    fontSize: 16,
    fontWeight: '600',
    color: '#1F8A4E',
  },
  body: {
    padding: 16,
    gap: 10,
  },
  preview: {
    width: '100%',
    height: 160,
    borderRadius: 12,
    backgroundColor: '#f6f6f9',
  },
  previewEmpty: {
    height: 120,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e5ea',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#fafafa',
  },
  previewHint: {
    fontFamily,
    fontSize: 13,
    color: '#8e8e93',
  },
  section: {
    fontFamily,
    fontSize: 11,
    fontWeight: '600',
    color: '#8e8e93',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
    marginTop: 6,
  },
  choice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 44,
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
  choiceLabel: {
    fontFamily,
    fontSize: 15,
    fontWeight: '500',
    color: '#1d1d1f',
  },
  qrCard: {
    alignItems: 'center',
    gap: 10,
    padding: 14,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e5ea',
    backgroundColor: '#fafafa',
  },
  qr: {
    width: 168,
    height: 168,
  },
  qrPlaceholder: {
    width: 168,
    height: 168,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qrHint: {
    fontFamily,
    fontSize: 13,
    lineHeight: 18,
    color: '#6e6e73',
    textAlign: 'center',
  },
  qrLink: {
    fontFamily,
    fontSize: 11,
    color: '#8e8e93',
    textAlign: 'center',
  },
  waiting: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: '#1F8A4E',
  },
  remove: {
    alignSelf: 'flex-start',
    paddingVertical: 4,
  },
  removeText: {
    fontFamily,
    fontSize: 14,
    fontWeight: '600',
    color: '#C0392B',
  },
  error: {
    fontFamily,
    fontSize: 13,
    color: '#C0392B',
  },
  previewShell: {
    height: 280,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#111',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  overlayText: {
    fontFamily,
    fontSize: 15,
    color: '#fff',
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  action: {
    fontFamily,
    fontSize: 16,
    fontWeight: '600',
    color: '#1F8A4E',
  },
  muted: {
    fontFamily,
    fontSize: 16,
    fontWeight: '500',
    color: '#6e6e73',
  },
});
