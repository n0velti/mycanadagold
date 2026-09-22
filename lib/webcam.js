import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';

export function webcamSupported() {
  return Platform.OS === 'web' && Boolean(navigator?.mediaDevices?.getUserMedia);
}

export function stopMediaStream(stream) {
  if (!stream) return;
  stream.getTracks().forEach((track) => {
    try {
      track.stop();
    } catch {
      // Some browsers throw if a track is already stopped.
    }
  });
}

export function getVideoElement(node) {
  if (!node) return null;
  if (typeof node.play === 'function' && 'srcObject' in node) return node;
  if (typeof node.querySelector === 'function') {
    const nested = node.querySelector('video');
    if (nested) return nested;
  }
  return null;
}

export function bindWebcamVideo(node, stream) {
  const video = getVideoElement(node);
  if (!video || !stream) return null;

  video.muted = true;
  video.defaultMuted = true;
  video.playsInline = true;
  video.autoplay = true;
  try {
    video.setAttribute('autoplay', '');
    video.setAttribute('muted', '');
    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', '');
  } catch {
    // ignore
  }

  if (video.srcObject !== stream) {
    video.srcObject = stream;
  }

  const play = () => {
    const result = video.play();
    if (result && typeof result.catch === 'function') {
      result.catch((err) => {
        if (err?.name === 'AbortError' || err?.name === 'NotAllowedError') return;
      });
    }
  };

  if (typeof video.addEventListener === 'function') {
    video.addEventListener('loadedmetadata', play, { once: true });
  }
  play();
  return video;
}

const FALLBACK_CONSTRAINTS = [{ video: true, audio: false }];

export async function requestUserMedia(constraintSets) {
  if (!navigator?.mediaDevices?.getUserMedia) {
    const error = new Error('unsupported');
    error.name = 'NotSupportedError';
    throw error;
  }

  const attempts = [...(constraintSets || []), ...FALLBACK_CONSTRAINTS];
  let lastError;
  for (const constraints of attempts) {
    try {
      return await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err) {
      lastError = err;
      if (err?.name === 'NotAllowedError' || err?.name === 'SecurityError') break;
      if (err?.name === 'NotReadableError') {
        try {
          return await navigator.mediaDevices.getUserMedia(constraints);
        } catch (retryErr) {
          lastError = retryErr;
          if (retryErr?.name === 'NotAllowedError' || retryErr?.name === 'SecurityError') break;
        }
      }
    }
  }
  throw lastError || new Error('denied');
}

export function useWebcam({ active = false, autoStart = false, constraints } = {}) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const sessionRef = useRef(0);
  const startingRef = useRef(false);
  const constraintsRef = useRef(constraints);
  constraintsRef.current = constraints;
  const [cameraState, setCameraState] = useState(active && autoStart ? 'requesting' : 'idle');

  const stopStream = useCallback(() => {
    stopMediaStream(streamRef.current);
    streamRef.current = null;
    const video = getVideoElement(videoRef.current);
    if (video) video.srcObject = null;
  }, []);

  const setVideoNode = useCallback((node) => {
    videoRef.current = node;
    if (node && streamRef.current) {
      bindWebcamVideo(node, streamRef.current);
    }
  }, []);

  const startCamera = useCallback(async () => {
    if (!webcamSupported()) {
      setCameraState('unsupported');
      return;
    }

    const session = ++sessionRef.current;
    startingRef.current = true;
    stopStream();
    setCameraState('requesting');

    const preview = getVideoElement(videoRef.current);
    if (preview) {
      preview.muted = true;
      preview.defaultMuted = true;
      preview.playsInline = true;
      const unlock = preview.play?.();
      if (unlock && typeof unlock.catch === 'function') unlock.catch(() => {});
    }

    try {
      const stream = await requestUserMedia(constraintsRef.current);
      if (session !== sessionRef.current) {
        stopMediaStream(stream);
        return;
      }
      streamRef.current = stream;
      bindWebcamVideo(videoRef.current, stream);
      setCameraState('live');
    } catch {
      if (session !== sessionRef.current) return;
      stopStream();
      setCameraState('denied');
    } finally {
      if (session === sessionRef.current) startingRef.current = false;
    }
  }, [stopStream]);

  useEffect(() => {
    if (!active) {
      sessionRef.current += 1;
      startingRef.current = false;
      stopStream();
      setCameraState('idle');
      return undefined;
    }
    if (autoStart && !startingRef.current) void startCamera();
    return () => {
      sessionRef.current += 1;
      startingRef.current = false;
      stopStream();
    };
  }, [active, autoStart, startCamera, stopStream]);

  useEffect(() => {
    if (!active || Platform.OS !== 'web' || !navigator.permissions?.query) return undefined;
    let status;
    let cancelled = false;
    const onChange = () => {
      if (cancelled || status?.state !== 'granted') return;
      if (startingRef.current || streamRef.current) return;
      void startCamera();
    };
    navigator.permissions
      .query({ name: 'camera' })
      .then((result) => {
        if (cancelled) return;
        status = result;
        if (typeof status.addEventListener === 'function') {
          status.addEventListener('change', onChange);
        } else {
          status.onchange = onChange;
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (!status) return;
      if (typeof status.removeEventListener === 'function') {
        status.removeEventListener('change', onChange);
      } else if (status.onchange === onChange) {
        status.onchange = null;
      }
    };
  }, [active, startCamera]);

  return {
    videoRef,
    streamRef,
    cameraState,
    startCamera,
    stopStream,
    setVideoNode,
  };
}
