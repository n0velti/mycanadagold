import { createElement, useState } from 'react';
import * as ImagePicker from 'expo-image-picker';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { uploadCapturePhoto } from '../lib/tradePhotos';
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
  return asset?.base64 ? `data:${mime};base64,${asset.base64}` : asset?.uri || '';
}

export default function LinePhotoCapturePage({ token }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const cameraOn = webcamSupported();
  const { videoRef, cameraState, startCamera, stopStream, setVideoNode } = useWebcam({
    active: cameraOn && !done,
    autoStart: true,
    constraints: CAMERA_CONSTRAINTS,
  });

  const send = async (dataUrl) => {
    if (!dataUrl || busy) return;
    setBusy(true);
    setError('');
    try {
      const url = await uploadCapturePhoto(token, dataUrl);
      if (!url) throw new Error('Could not upload that photo.');
      stopStream();
      setDone(true);
    } catch (err) {
      const message = err?.message || 'Could not upload that photo.';
      setError(/sign-in service/i.test(message) ? 'Could not upload that photo. Try again.' : message);
    } finally {
      setBusy(false);
    }
  };

  const snap = () => {
    const dataUrl = captureFrame(getVideoElement(videoRef.current));
    if (!dataUrl) {
      setError('Could not capture a frame. Try again.');
      return;
    }
    void send(dataUrl);
  };

  const pick = async () => {
    setError('');
    try {
      if (Platform.OS !== 'web') {
        const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!permission.granted) {
          setError('Allow photo access to upload an image.');
          return;
        }
      }
      const result = await ImagePicker.launchImageLibraryAsync(PICKER_OPTIONS);
      if (result.canceled || !result.assets?.[0]) return;
      const dataUrl = fromPickerAsset(result.assets[0]);
      if (!dataUrl?.startsWith('data:')) {
        setError('Could not read that photo.');
        return;
      }
      await send(dataUrl);
    } catch (err) {
      setError(err?.message || 'Could not open the photo library.');
    }
  };

  const takeNative = async () => {
    setError('');
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        setError('Allow camera access to take a photo.');
        return;
      }
      const result = await ImagePicker.launchCameraAsync(PICKER_OPTIONS);
      if (result.canceled || !result.assets?.[0]) return;
      const dataUrl = fromPickerAsset(result.assets[0]);
      await send(dataUrl);
    } catch (err) {
      setError(err?.message || 'Could not open the camera.');
    }
  };

  return (
    <View style={styles.screen}>
      <StatusBar style="dark" />
      <Text style={styles.kicker}>Canada Gold</Text>
      <Text style={styles.title}>{done ? 'Photo sent' : 'Item photo'}</Text>
      <Text style={styles.body}>
        {done
          ? 'This photo is on the buy ticket. You can close this page.'
          : 'Line up the item, then snap. The photo attaches to the ticket on the computer.'}
      </Text>

      {done ? (
        <View style={styles.doneMark}>
          <Ionicons name="checkmark-circle" size={56} color="#1F8A4E" />
        </View>
      ) : (
        <>
          {cameraOn ? (
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
                    {cameraState === 'denied' ? 'Allow camera access to continue.' : 'Starting camera…'}
                  </Text>
                </View>
              ) : null}
            </View>
          ) : null}

          {error ? <Text style={styles.error}>{error}</Text> : null}

          {cameraOn ? (
            <Pressable
              style={[styles.primary, (busy || cameraState !== 'live') && styles.disabled]}
              onPress={snap}
              disabled={busy || cameraState !== 'live'}
            >
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Snap photo</Text>}
            </Pressable>
          ) : (
            <Pressable style={styles.primary} onPress={() => void takeNative()} disabled={busy}>
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Open camera</Text>}
            </Pressable>
          )}

          <Pressable style={styles.secondary} onPress={() => void pick()} disabled={busy}>
            <Text style={styles.secondaryText}>Choose from library</Text>
          </Pressable>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#fff',
    paddingHorizontal: 24,
    paddingTop: 56,
    paddingBottom: 32,
    gap: 12,
  },
  kicker: {
    fontFamily,
    fontSize: 12,
    fontWeight: '600',
    color: '#1F8A4E',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  title: {
    fontFamily,
    fontSize: 28,
    fontWeight: '600',
    color: '#1d1d1f',
    letterSpacing: -0.6,
  },
  body: {
    fontFamily,
    fontSize: 16,
    lineHeight: 22,
    color: '#6e6e73',
    marginBottom: 8,
  },
  previewShell: {
    height: 360,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#111',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  overlayText: {
    fontFamily,
    fontSize: 16,
    color: '#fff',
    textAlign: 'center',
  },
  primary: {
    minHeight: 52,
    borderRadius: 12,
    backgroundColor: '#1F8A4E',
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: {
    opacity: 0.55,
  },
  primaryText: {
    fontFamily,
    fontSize: 17,
    fontWeight: '600',
    color: '#fff',
  },
  secondary: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryText: {
    fontFamily,
    fontSize: 16,
    fontWeight: '600',
    color: '#1F8A4E',
  },
  error: {
    fontFamily,
    fontSize: 14,
    color: '#C0392B',
  },
  doneMark: {
    alignItems: 'center',
    paddingVertical: 48,
  },
});
