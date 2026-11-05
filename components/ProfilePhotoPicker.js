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
  useWindowDimensions,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { assetToDataUrl, prepareAvatarAsset } from '../lib/avatarCartoon';
import { getVideoElement, useWebcam, webcamSupported } from '../lib/webcam';

const fontFamily = 'Sohne';

const PICKER_OPTIONS = {
  mediaTypes: ['images'],
  allowsEditing: true,
  aspect: [1, 1],
  quality: 0.8,
};

const CAMERA_CONSTRAINTS = [
  { video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false },
];

function captureSquareFrame(video) {
  if (!video || !video.videoWidth || !video.videoHeight) return null;
  const size = Math.min(video.videoWidth, video.videoHeight);
  const sx = Math.round((video.videoWidth - size) / 2);
  const sy = Math.round((video.videoHeight - size) / 2);
  const output = Math.min(size, 1280);
  const canvas = document.createElement('canvas');
  canvas.width = output;
  canvas.height = output;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.translate(output, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(video, sx, sy, size, size, 0, 0, output, output);
  return canvas.toDataURL('image/jpeg', 0.9);
}

export default function ProfilePhotoPicker({ visible, onClose, onConfirm }) {
  const { width } = useWindowDimensions();
  const compact = width < 640;
  const abortRef = useRef(null);
  const [step, setStep] = useState('source');
  const [sourceUri, setSourceUri] = useState('');
  const [previewUri, setPreviewUri] = useState('');
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const { videoRef, cameraState, startCamera, stopStream, setVideoNode } = useWebcam({
    active: visible && step === 'camera',
    autoStart: true,
    constraints: CAMERA_CONSTRAINTS,
  });

  useEffect(() => {
    if (!visible) {
      abortRef.current?.abort();
      abortRef.current = null;
      stopStream();
      setStep('source');
      setSourceUri('');
      setPreviewUri('');
      setOpening(false);
      setError('');
      setSaving(false);
      return undefined;
    }
    return undefined;
  }, [visible, stopStream]);

  const close = () => {
    if (saving) return;
    abortRef.current?.abort();
    onClose?.();
  };

  const acceptPhoto = async (asset) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setError('');
    setPreviewUri('');
    setOpening(true);
    try {
      const source = await assetToDataUrl(asset);
      if (controller.signal.aborted) return;
      setSourceUri(source);
      setPreviewUri(source);
      setStep('preview');
    } catch (err) {
      if (err?.name === 'AbortError' || controller.signal.aborted) return;
      setError(err?.message || 'Could not read that photo. Try another.');
      setStep('source');
    } finally {
      setOpening(false);
      if (abortRef.current === controller) abortRef.current = null;
    }
  };

  const pickFromLibrary = async () => {
    setError('');
    try {
      if (Platform.OS !== 'web') {
        const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!permission.granted) {
          setError('Allow photo access to set a profile picture.');
          return;
        }
      }
      const result = await ImagePicker.launchImageLibraryAsync(PICKER_OPTIONS);
      if (result.canceled || !result.assets?.[0]) return;
      await acceptPhoto(result.assets[0]);
    } catch (err) {
      setError(err?.message || 'Could not open the photo library.');
    }
  };

  const takeNativePhoto = async () => {
    setError('');
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        setError('Allow camera access to take a profile picture.');
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        ...PICKER_OPTIONS,
        cameraType: 'front',
      });
      if (result.canceled || !result.assets?.[0]) return;
      await acceptPhoto(result.assets[0]);
    } catch (err) {
      setError(err?.message || 'Could not open the camera.');
    }
  };

  const handleTakePhoto = () => {
    if (webcamSupported()) {
      setError('');
      setStep('camera');
      void startCamera();
      return;
    }
    void takeNativePhoto();
  };

  const captureWebcam = () => {
    if (cameraState !== 'live') return;
    const dataUrl = captureSquareFrame(getVideoElement(videoRef.current));
    if (!dataUrl) {
      setError('Could not capture a frame. Try again.');
      return;
    }
    stopStream();
    void acceptPhoto({ uri: dataUrl, mimeType: 'image/jpeg' });
  };

  const handleUsePortrait = async () => {
    if (!previewUri || saving) return;
    setSaving(true);
    setError('');
    try {
      const asset = await prepareAvatarAsset(previewUri);
      await onConfirm?.(asset);
    } catch (err) {
      setError(err?.message || 'Could not save that portrait.');
    } finally {
      setSaving(false);
    }
  };

  const cardWidth = Math.min(compact ? width - 32 : 420, width - 24);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <View style={styles.root}>
        <Pressable style={styles.backdrop} onPress={close} />
        <View style={[styles.card, { width: cardWidth }]}>
          {step === 'source' ? (
            <>
              <Text style={styles.title}>Profile photo</Text>
              <Text style={styles.body}>
                Take a photo or choose one. This picture shows next to your name.
              </Text>
              <Pressable style={styles.choice} onPress={handleTakePhoto} disabled={opening}>
                <View style={[styles.choiceIcon, { backgroundColor: '#EEF4FF' }]}>
                  <Ionicons name="camera-outline" size={18} color="#3B6FE0" />
                </View>
                <View style={styles.choiceText}>
                  <Text style={styles.choiceLabel}>Take a photo</Text>
                  <Text style={styles.choiceHint}>
                    {webcamSupported() ? 'Uses this computer’s webcam' : 'Opens the camera'}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color="#9a9a9a" />
              </Pressable>
              <Pressable style={styles.choice} onPress={() => void pickFromLibrary()} disabled={opening}>
                <View style={[styles.choiceIcon, { backgroundColor: '#F4F4F5' }]}>
                  <Ionicons name="images-outline" size={18} color="#52525B" />
                </View>
                <View style={styles.choiceText}>
                  <Text style={styles.choiceLabel}>Choose a photo</Text>
                  <Text style={styles.choiceHint}>From files or your photo library</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color="#9a9a9a" />
              </Pressable>
              {opening ? (
                <View style={styles.openingRow}>
                  <ActivityIndicator color="#1d1d1f" />
                  <Text style={styles.openingText}>Opening photo…</Text>
                </View>
              ) : null}
              {error ? <Text style={styles.error}>{error}</Text> : null}
              <Pressable style={styles.cancel} onPress={close} disabled={opening}>
                <Text style={styles.cancelText}>Cancel</Text>
              </Pressable>
            </>
          ) : null}

          {step === 'camera' ? (
            <>
              <Text style={styles.title}>Take a photo</Text>
              <Text style={styles.body}>
                Center your face in the oval, in good light.
              </Text>
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
                        transform: 'scaleX(-1)',
                        backgroundColor: '#111',
                        outline: 'none',
                        border: 'none',
                      },
                    })
                  : null}
                <View style={styles.faceGuide} pointerEvents="none" />
                {cameraState !== 'live' ? (
                  <View style={styles.overlay}>
                    <Text style={styles.overlayTitle}>
                      {cameraState === 'requesting'
                        ? 'Starting webcam…'
                        : cameraState === 'denied'
                          ? 'Camera access blocked'
                          : cameraState === 'unsupported'
                            ? 'Webcam unavailable'
                            : 'Camera ready'}
                    </Text>
                    <Text style={styles.overlayBody}>
                      {cameraState === 'denied'
                        ? 'Allow camera access in your browser, then try again.'
                        : cameraState === 'unsupported'
                          ? 'Open this app in a browser that can use the webcam.'
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
              {opening ? (
                <View style={styles.openingRow}>
                  <ActivityIndicator color="#1d1d1f" />
                  <Text style={styles.openingText}>Opening photo…</Text>
                </View>
              ) : null}
              {error ? <Text style={styles.error}>{error}</Text> : null}
              <View style={styles.actions}>
                <Pressable
                  style={styles.secondary}
                  onPress={() => setStep('source')}
                  disabled={opening}
                >
                  <Text style={[styles.secondaryText, opening && styles.secondaryDisabled]}>Back</Text>
                </Pressable>
                <Pressable
                  style={[styles.primary, (cameraState !== 'live' || opening) && styles.primaryDisabled]}
                  onPress={captureWebcam}
                  disabled={cameraState !== 'live' || opening}
                >
                  <Text style={styles.primaryText}>Capture</Text>
                </Pressable>
              </View>
            </>
          ) : null}

          {step === 'preview' ? (
            <>
              <Text style={styles.title}>{previewUri ? 'Your profile photo' : 'Could not use that photo'}</Text>
              <Text style={styles.body}>
                {previewUri
                  ? 'This picture will show next to your name.'
                  : 'Try another photo, or take one with the webcam.'}
              </Text>
              <View style={styles.previewShell}>
                {previewUri || sourceUri ? (
                  <Image source={{ uri: previewUri || sourceUri }} style={styles.previewImage} />
                ) : null}
              </View>
              {error ? <Text style={styles.error}>{error}</Text> : null}
              <View style={styles.actions}>
                <Pressable
                  style={styles.secondary}
                  onPress={() => setStep('source')}
                  disabled={saving}
                >
                  <Text style={[styles.secondaryText, saving && styles.secondaryDisabled]}>
                    Try again
                  </Text>
                </Pressable>
                {previewUri ? (
                  <Pressable
                    style={[styles.primary, saving && styles.primaryDisabled]}
                    onPress={() => void handleUsePortrait()}
                    disabled={saving}
                  >
                    {saving ? (
                      <ActivityIndicator color="#fff" />
                    ) : (
                      <Text style={styles.primaryText}>Use this photo</Text>
                    )}
                  </Pressable>
                ) : null}
              </View>
            </>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.36)',
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 20,
    maxWidth: '100%',
    zIndex: 1,
    shadowColor: '#000',
    shadowOpacity: 0.16,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
  },
  title: {
    fontFamily,
    fontSize: 20,
    fontWeight: '700',
    color: '#1d1d1f',
    letterSpacing: -0.4,
  },
  body: {
    fontFamily,
    fontSize: 14,
    lineHeight: 20,
    color: '#6e6e73',
    marginTop: 6,
    marginBottom: 16,
    letterSpacing: -0.1,
  },
  choice: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e5e5ea',
  },
  choiceIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  choiceText: {
    flex: 1,
  },
  choiceLabel: {
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: '#1d1d1f',
    letterSpacing: -0.2,
  },
  choiceHint: {
    fontFamily,
    fontSize: 13,
    color: '#8e8e93',
    marginTop: 2,
  },
  cancel: {
    alignItems: 'center',
    paddingTop: 14,
  },
  cancelText: {
    fontFamily,
    fontSize: 15,
    fontWeight: '500',
    color: '#2F6FED',
  },
  previewShell: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: '#111',
    position: 'relative',
  },
  previewImage: {
    width: '100%',
    height: '100%',
  },
  faceGuide: {
    position: 'absolute',
    left: '16%',
    right: '16%',
    top: '12%',
    bottom: '18%',
    borderRadius: 999,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.55)',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
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
    lineHeight: 18,
    color: 'rgba(255,255,255,0.78)',
    textAlign: 'center',
    marginTop: 8,
  },
  openingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
  },
  openingText: {
    fontFamily,
    fontSize: 13,
    color: '#6e6e73',
  },
  retry: {
    marginTop: 14,
    backgroundColor: '#fff',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  retryText: {
    fontFamily,
    fontSize: 14,
    fontWeight: '600',
    color: '#1d1d1f',
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 16,
  },
  primary: {
    backgroundColor: '#1d1d1f',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    minHeight: 40,
    justifyContent: 'center',
  },
  primaryDisabled: {
    opacity: 0.45,
  },
  primaryText: {
    fontFamily,
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
  secondary: {
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    minHeight: 40,
    justifyContent: 'center',
  },
  secondaryText: {
    fontFamily,
    fontSize: 14,
    fontWeight: '600',
    color: '#1d1d1f',
  },
  secondaryDisabled: {
    opacity: 0.45,
  },
  error: {
    fontFamily,
    fontSize: 13,
    color: '#c41e3a',
    marginTop: 12,
    lineHeight: 18,
  },
});
