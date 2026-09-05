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
import { Ionicons } from '@expo/vector-icons';
import { prepareAvatarAsset, stylizeAvatarPhoto } from '../lib/avatarCartoon';

const fontFamily = 'Sohne';

const PICKER_OPTIONS = {
  mediaTypes: ['images'],
  allowsEditing: true,
  aspect: [1, 1],
  quality: 0.8,
};

function webcamSupported() {
  return Platform.OS === 'web' && Boolean(navigator?.mediaDevices?.getUserMedia);
}

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
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const abortRef = useRef(null);
  const [step, setStep] = useState('source');
  const [cameraState, setCameraState] = useState('idle');
  const [sourceUri, setSourceUri] = useState('');
  const [cartoonUri, setCartoonUri] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

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
  };

  useEffect(() => {
    if (!visible) {
      abortRef.current?.abort();
      abortRef.current = null;
      stopStream();
      setStep('source');
      setCameraState('idle');
      setSourceUri('');
      setCartoonUri('');
      setError('');
      setSaving(false);
      return undefined;
    }
    return undefined;
  }, [visible]);

  useEffect(() => {
    if (!visible || step !== 'camera') {
      stopStream();
      return undefined;
    }
    void startCamera();
    return () => stopStream();
  }, [visible, step]);

  const close = () => {
    if (saving) return;
    abortRef.current?.abort();
    onClose?.();
  };

  const stylize = async (asset) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setError('');
    setCartoonUri('');
    setStep('stylizing');
    const source = typeof asset === 'string' ? asset : asset?.uri || '';
    try {
      setSourceUri(source);
      const cartoon = await stylizeAvatarPhoto(asset, { signal: controller.signal });
      if (controller.signal.aborted) return;
      setCartoonUri(cartoon);
      setStep('preview');
    } catch (err) {
      if (err?.name === 'AbortError' || controller.signal.aborted) return;
      setError(err?.message || 'Could not draw that portrait. Try another photo.');
      setStep(source ? 'preview' : 'source');
    } finally {
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
      await stylize(result.assets[0]);
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
      await stylize(result.assets[0]);
    } catch (err) {
      setError(err?.message || 'Could not open the camera.');
    }
  };

  const handleTakePhoto = () => {
    if (webcamSupported()) {
      setError('');
      setStep('camera');
      return;
    }
    void takeNativePhoto();
  };

  const captureWebcam = () => {
    if (cameraState !== 'live') return;
    const dataUrl = captureSquareFrame(videoRef.current);
    if (!dataUrl) {
      setError('Could not capture a frame. Try again.');
      return;
    }
    stopStream();
    void stylize({ uri: dataUrl, mimeType: 'image/jpeg' });
  };

  const handleUsePortrait = async () => {
    if (!cartoonUri || saving) return;
    setSaving(true);
    setError('');
    try {
      const asset = await prepareAvatarAsset(cartoonUri);
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
              <Text style={styles.title}>Canada Gold portrait</Text>
              <Text style={styles.body}>
                Take a photo or choose one. We redraw you as a fun Disney cartoon that still
                looks like you — your face, with a unique shirt and background.
              </Text>
              <Pressable style={styles.choice} onPress={handleTakePhoto}>
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
              <Pressable style={styles.choice} onPress={() => void pickFromLibrary()}>
                <View style={[styles.choiceIcon, { backgroundColor: '#F4F4F5' }]}>
                  <Ionicons name="images-outline" size={18} color="#52525B" />
                </View>
                <View style={styles.choiceText}>
                  <Text style={styles.choiceLabel}>Choose a photo</Text>
                  <Text style={styles.choiceHint}>From files or your photo library</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color="#9a9a9a" />
              </Pressable>
              {error ? <Text style={styles.error}>{error}</Text> : null}
              <Pressable style={styles.cancel} onPress={close}>
                <Text style={styles.cancelText}>Cancel</Text>
              </Pressable>
            </>
          ) : null}

          {step === 'camera' ? (
            <>
              <Text style={styles.title}>Take a photo</Text>
              <Text style={styles.body}>Center your face, then capture. We draw a Disney cartoon that still looks like you.</Text>
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
                    {cameraState === 'denied' || cameraState === 'unsupported' ? (
                      <Pressable style={styles.retry} onPress={() => void startCamera()}>
                        <Text style={styles.retryText}>Enable camera</Text>
                      </Pressable>
                    ) : null}
                  </View>
                ) : null}
              </View>
              {error ? <Text style={styles.error}>{error}</Text> : null}
              <View style={styles.actions}>
                <Pressable style={styles.secondary} onPress={() => setStep('source')}>
                  <Text style={styles.secondaryText}>Back</Text>
                </Pressable>
                <Pressable
                  style={[styles.primary, cameraState !== 'live' && styles.primaryDisabled]}
                  onPress={captureWebcam}
                  disabled={cameraState !== 'live'}
                >
                  <Text style={styles.primaryText}>Capture</Text>
                </Pressable>
              </View>
            </>
          ) : null}

          {step === 'stylizing' ? (
            <>
              <Text style={styles.title}>Drawing your portrait</Text>
              <Text style={styles.body}>
                Drawing you as a Disney cartoon from this photo. This usually takes about 30 seconds.
              </Text>
              <View style={styles.previewShell}>
                {sourceUri ? (
                  <Image source={{ uri: sourceUri }} style={styles.previewImage} />
                ) : null}
                <View style={styles.overlay}>
                  <ActivityIndicator color="#fff" />
                  <Text style={[styles.overlayTitle, styles.overlaySpaced]}>Redrawing you…</Text>
                </View>
              </View>
              <Pressable style={styles.cancel} onPress={close}>
                <Text style={styles.cancelText}>Cancel</Text>
              </Pressable>
            </>
          ) : null}

          {step === 'preview' ? (
            <>
              <Text style={styles.title}>{cartoonUri ? 'Your Canada Gold portrait' : 'Could not draw it'}</Text>
              <Text style={styles.body}>
                {cartoonUri
                  ? 'This is the cartoon version of you that will show next to your name.'
                  : 'Try another photo, or take one with the webcam.'}
              </Text>
              <View style={styles.previewShell}>
                {cartoonUri || sourceUri ? (
                  <Image source={{ uri: cartoonUri || sourceUri }} style={styles.previewImage} />
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
                {cartoonUri ? (
                  <Pressable
                    style={[styles.primary, saving && styles.primaryDisabled]}
                    onPress={() => void handleUsePortrait()}
                    disabled={saving}
                  >
                    {saving ? (
                      <ActivityIndicator color="#fff" />
                    ) : (
                      <Text style={styles.primaryText}>Use this portrait</Text>
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
  overlaySpaced: {
    marginTop: 10,
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
