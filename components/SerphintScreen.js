import { createElement, useEffect, useRef, useState } from 'react';
import {
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  analyzeBullionEnsemble,
  analyzeBullionInImage,
  formatModelReleased,
  getModelMeta,
  OPENROUTER_MODELS,
  reasonBullionConsensus,
  REASONER_MODELS,
  sampleImageFrames,
} from '../lib/openrouter';

const fontFamily = Platform.select({
  ios: 'Sohne',
  android: 'Sohne',
  default: 'Sohne',
});

const ACCENT = '#047857';

const MODEL_OPTIONS = OPENROUTER_MODELS;
const DEFAULT_SINGLE_MODEL =
  MODEL_OPTIONS.find((model) => model.key === 'anthropic/claude-sonnet-5')?.key ||
  MODEL_OPTIONS[0].key;
const DEFAULT_WORKER_KEYS = [
  'anthropic/claude-sonnet-5',
  'openai/gpt-4o-mini',
  'qwen/qwen3-vl-8b-instruct',
].filter((key) => MODEL_OPTIONS.some((model) => model.key === key));
const DEFAULT_REASONER_KEY =
  REASONER_MODELS.find((model) => model.key === 'anthropic/claude-opus-5')?.key ||
  REASONER_MODELS.find((model) => model.key === 'qwen/qwen3-vl-30b-a3b-instruct')?.key ||
  REASONER_MODELS[0].key;

const MAX_VIDEO_ANALYSIS_FRAMES = 10;

function formatRecordingTime(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function downloadUri(uri, filename) {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return;
  const link = document.createElement('a');
  link.href = uri;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read image file'));
    reader.readAsDataURL(file);
  });
}

function formatElapsed(ms) {
  const seconds = Math.max(0, ms) / 1000;
  return `${seconds.toFixed(1)}s`;
}

function modelOptionMetaLine(option) {
  const parts = [];
  if (option.provider) parts.push(option.provider);
  parts.push(`Speed: ${option.speed}`);
  parts.push(`Accuracy: ${option.accuracy}`);
  if (option.released) parts.push(`Released ${formatModelReleased(option.released)}`);
  if (option.supportsVision === false) parts.push('Text judge');
  return parts.join('  ·  ');
}

export default function SerphintScreen() {
  const { width } = useWindowDimensions();
  const stacked = width < 900;
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const captureUrlsRef = useRef([]);
  const frameIntervalRef = useRef(null);
  const frameCountRef = useRef(0);
  const sessionIdRef = useRef(null);
  const bullionAbortRef = useRef(null);
  const fileInputRef = useRef(null);
  const bullionTimerRef = useRef(null);
  const recordingFramesRef = useRef([]);

  const [cameraState, setCameraState] = useState('idle');
  const [recording, setRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [frameIntervalSec, setFrameIntervalSec] = useState('2');
  const [captures, setCaptures] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [analysisMode, setAnalysisMode] = useState('single');
  const [singleModel, setSingleModel] = useState(DEFAULT_SINGLE_MODEL);
  const [selectedWorkerKeys, setSelectedWorkerKeys] = useState(DEFAULT_WORKER_KEYS);
  const [reasonerModel, setReasonerModel] = useState(DEFAULT_REASONER_KEY);
  const [singleMenuOpen, setSingleMenuOpen] = useState(false);
  const [workerMenuOpen, setWorkerMenuOpen] = useState(false);
  const [reasonerMenuOpen, setReasonerMenuOpen] = useState(false);
  const [uploadUri, setUploadUri] = useState(null);
  const [dragActive, setDragActive] = useState(false);
  const [bullionStatus, setBullionStatus] = useState('idle');
  const [bullionPhase, setBullionPhase] = useState('idle');
  const [bullionText, setBullionText] = useState('');
  const [bullionItems, setBullionItems] = useState([]);
  const [bullionVotes, setBullionVotes] = useState([]);
  const [bullionError, setBullionError] = useState('');
  const [bullionElapsedMs, setBullionElapsedMs] = useState(0);
  const [bullionSource, setBullionSource] = useState(null);

  const selectedCapture = captures.find((item) => item.id === selectedId) ?? null;
  const parsedInterval = Math.max(1, Math.round(Number(frameIntervalSec) || 5));
  const isEnsemble = analysisMode === 'ensemble';
  const singleModelMeta = getModelMeta(singleModel, MODEL_OPTIONS) || MODEL_OPTIONS[0];
  const selectedWorkers = MODEL_OPTIONS.filter((option) =>
    selectedWorkerKeys.includes(option.key)
  );
  const reasonerMeta =
    getModelMeta(reasonerModel, REASONER_MODELS) || REASONER_MODELS[0];
  const workerSummary =
    selectedWorkers.length === 0
      ? 'Select worker models'
      : selectedWorkers.length === 1
        ? selectedWorkers[0].label
        : `${selectedWorkers.length} models selected`;

  const clearBullionTimer = () => {
    if (bullionTimerRef.current != null) {
      clearInterval(bullionTimerRef.current);
      bullionTimerRef.current = null;
    }
  };

  const startBullionTimer = () => {
    clearBullionTimer();
    const startedAt = Date.now();
    setBullionElapsedMs(0);
    bullionTimerRef.current = setInterval(() => {
      setBullionElapsedMs(Date.now() - startedAt);
    }, 100);
  };

  const rememberUrl = (uri) => {
    captureUrlsRef.current.push(uri);
  };

  const forgetUrl = (uri) => {
    captureUrlsRef.current = captureUrlsRef.current.filter((entry) => entry !== uri);
    if (uri.startsWith('blob:')) {
      URL.revokeObjectURL(uri);
    }
  };

  const stopFrameCapture = () => {
    if (frameIntervalRef.current != null) {
      clearInterval(frameIntervalRef.current);
      frameIntervalRef.current = null;
    }
  };

  const stopStream = () => {
    stopFrameCapture();
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
    }
    recorderRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  };

  const startCamera = async () => {
    if (Platform.OS !== 'web') {
      setCameraState('unsupported');
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraState('unsupported');
      return;
    }

    setCameraState('requesting');

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width: { ideal: 1280 },
          height: { ideal: 720 },
          aspectRatio: { ideal: 16 / 9 },
        },
        audio: true,
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
          video: {
            facingMode: 'user',
            width: { ideal: 1280 },
            height: { ideal: 720 },
            aspectRatio: { ideal: 16 / 9 },
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
        setCameraState('denied');
      }
    }
  };

  useEffect(() => {
    void startCamera();
    return () => {
      bullionAbortRef.current?.abort();
      clearBullionTimer();
      stopStream();
      captureUrlsRef.current.forEach((uri) => {
        if (uri.startsWith('blob:')) {
          URL.revokeObjectURL(uri);
        }
      });
      captureUrlsRef.current = [];
    };
  }, []);

  const toggleWorkerModel = (key) => {
    setSelectedWorkerKeys((current) => {
      if (current.includes(key)) {
        if (current.length === 1) return current;
        return current.filter((entry) => entry !== key);
      }
      return [...current, key];
    });
  };

  const upsertVote = (setter, vote) => {
    setter((current) => {
      const next = current.filter((entry) => entry.model !== vote.model);
      return [...next, vote].sort((a, b) => a.label.localeCompare(b.label));
    });
  };

  const runBullionAnalysis = async (imageDataUrlOrUrls, { source = 'upload' } = {}) => {
    const imageDataUrls = (
      Array.isArray(imageDataUrlOrUrls) ? imageDataUrlOrUrls : [imageDataUrlOrUrls]
    ).filter(Boolean);

    if (imageDataUrls.length === 0) return;

    const workerKeys = isEnsemble ? selectedWorkerKeys : [singleModel];
    if (workerKeys.length === 0 || !workerKeys[0]) {
      setBullionStatus('error');
      setBullionError('Select at least one model.');
      setBullionPhase('error');
      return;
    }

    bullionAbortRef.current?.abort();
    const controller = new AbortController();
    bullionAbortRef.current = controller;

    const frameLabel =
      imageDataUrls.length > 1 ? ` from ${imageDataUrls.length} frames` : '';

    setBullionSource(source);
    setBullionStatus('analyzing');
    setBullionError('');
    setBullionItems([]);
    setBullionVotes([]);
    setBullionText(
      isEnsemble
        ? `Running worker models in parallel${frameLabel}…`
        : `Identifying bullion${frameLabel}…`
    );
    startBullionTimer();

    try {
      if (!isEnsemble) {
        const meta = getModelMeta(singleModel, MODEL_OPTIONS);
        const label = meta?.label || singleModel;
        const startedAt = Date.now();
        setBullionPhase('workers');
        setBullionVotes([
          {
            model: singleModel,
            label,
            status: 'analyzing',
            items: [],
            raw: '',
            error: null,
            elapsedMs: 0,
          },
        ]);

        const { raw, items } = await analyzeBullionInImage({
          imageDataUrls,
          model: singleModel,
          signal: controller.signal,
          onDelta: (full) => {
            setBullionText(full.trim() || `Identifying bullion${frameLabel}…`);
          },
        });
        if (controller.signal.aborted) return;

        const vote = {
          model: singleModel,
          label,
          status: 'ready',
          items,
          raw,
          error: null,
          elapsedMs: Date.now() - startedAt,
        };
        setBullionVotes([vote]);

        if (items.length > 0) {
          setBullionItems(items);
          setBullionText('');
        } else {
          setBullionItems([]);
          setBullionText(raw || 'Could not identify bullion in this image.');
        }
        setBullionStatus('ready');
        setBullionPhase('ready');
        return;
      }

      const pendingVotes = workerKeys.map((key) => {
        const meta = getModelMeta(key, MODEL_OPTIONS);
        return {
          model: key,
          label: meta?.label || key,
          status: 'analyzing',
          items: [],
          raw: '',
          error: null,
          elapsedMs: 0,
        };
      });

      setBullionPhase('workers');
      setBullionVotes(pendingVotes);

      const { votes, compressedDataUrls, compressedDataUrl } = await analyzeBullionEnsemble({
        imageDataUrls,
        models: workerKeys,
        signal: controller.signal,
        onWorkerUpdate: (vote) => upsertVote(setBullionVotes, vote),
      });
      if (controller.signal.aborted) return;

      setBullionVotes(votes.sort((a, b) => a.label.localeCompare(b.label)));
      setBullionPhase('reasoning');
      setBullionText('Reasoning final answer…');

      const { raw, items } = await reasonBullionConsensus({
        imageDataUrls,
        compressedDataUrls,
        compressedDataUrl,
        votes,
        model: reasonerModel,
        signal: controller.signal,
        onDelta: (full) => {
          setBullionText(full.trim() || 'Reasoning final answer…');
        },
      });
      if (controller.signal.aborted) return;

      if (items.length > 0) {
        setBullionItems(items);
        setBullionText('');
        setBullionStatus('ready');
        setBullionPhase('ready');
        return;
      }

      setBullionItems([]);
      setBullionText(raw || 'Could not identify bullion in this image.');
      setBullionStatus('ready');
      setBullionPhase('ready');
    } catch (error) {
      if (controller.signal.aborted || error?.name === 'AbortError') return;
      setBullionStatus('error');
      setBullionPhase('error');
      setBullionError(error?.message || 'Bullion analysis failed');
      setBullionText('');
      setBullionItems([]);
    } finally {
      if (bullionAbortRef.current === controller) {
        clearBullionTimer();
      }
    }
  };

  const handleUploadImage = async (file) => {
    if (!file || !String(file.type || '').startsWith('image/')) {
      setBullionStatus('error');
      setBullionPhase('error');
      setBullionError('Please upload an image file (JPG, PNG, WebP, etc.).');
      setBullionText('');
      setBullionItems([]);
      setBullionVotes([]);
      return;
    }

    try {
      const dataUrl = await fileToDataUrl(file);
      setUploadUri(dataUrl);
      void runBullionAnalysis(dataUrl, { source: 'upload' });
    } catch (error) {
      setBullionStatus('error');
      setBullionPhase('error');
      setBullionError(error?.message || 'Could not read image file');
      setBullionText('');
      setBullionItems([]);
      setBullionVotes([]);
    }
  };

  const clearUpload = () => {
    bullionAbortRef.current?.abort();
    clearBullionTimer();
    setUploadUri(null);
    setBullionStatus('idle');
    setBullionPhase('idle');
    setBullionText('');
    setBullionItems([]);
    setBullionVotes([]);
    setBullionError('');
    setBullionElapsedMs(0);
    setBullionSource(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  useEffect(() => {
    if (!recording) {
      setRecordingSeconds(0);
      return;
    }

    setRecordingSeconds(0);
    const intervalId = setInterval(() => {
      setRecordingSeconds((seconds) => seconds + 1);
    }, 1000);

    return () => clearInterval(intervalId);
  }, [recording]);

  const grabFrameDataUrl = () => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0 || video.videoHeight === 0) {
      return null;
    }

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.92);
  };

  const addCapture = (item) => {
    rememberUrl(item.uri);
    if (item.thumbnailUri && item.thumbnailUri !== item.uri) {
      rememberUrl(item.thumbnailUri);
    }
    setCaptures((current) => [item, ...current]);
  };

  const captureImage = ({ source = 'photo', sessionId = null, analyze = false } = {}) => {
    if (cameraState !== 'live') return null;

    const dataUrl = grabFrameDataUrl();
    if (!dataUrl) return null;

    const createdAt = Date.now();
    const frameIndex = source === 'interval' ? frameCountRef.current + 1 : null;
    if (source === 'interval') {
      frameCountRef.current += 1;
      recordingFramesRef.current.push(dataUrl);
    }

    const item = {
      id: `${source}-${createdAt}-${Math.random().toString(36).slice(2, 7)}`,
      kind: 'image',
      source,
      sessionId,
      frameIndex,
      intervalSec: source === 'interval' ? parsedInterval : null,
      uri: dataUrl,
      thumbnailUri: dataUrl,
      createdAt,
    };
    addCapture(item);

    if (analyze) {
      void runBullionAnalysis(dataUrl, { source: 'photo' });
    }

    return item;
  };

  const startFrameCapture = (sessionId) => {
    stopFrameCapture();
    frameCountRef.current = 0;
    recordingFramesRef.current = [];
    captureImage({ source: 'interval', sessionId });
    frameIntervalRef.current = setInterval(() => {
      captureImage({ source: 'interval', sessionId });
    }, parsedInterval * 1000);
  };

  const stopRecording = () => {
    stopFrameCapture();
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === 'inactive') {
      setRecording(false);
      return;
    }
    recorder.stop();
  };

  const startRecording = () => {
    if (Platform.OS !== 'web' || cameraState !== 'live' || !streamRef.current) return;
    if (typeof MediaRecorder === 'undefined') return;

    const sessionId = `session-${Date.now()}`;
    sessionIdRef.current = sessionId;
    chunksRef.current = [];
    recordingFramesRef.current = [];

    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
      ? 'video/webm;codecs=vp9'
      : MediaRecorder.isTypeSupported('video/webm')
        ? 'video/webm'
        : '';

    try {
      const recorder = mimeType
        ? new MediaRecorder(streamRef.current, { mimeType })
        : new MediaRecorder(streamRef.current);

      recorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || 'video/webm',
        });
        chunksRef.current = [];
        const uri = URL.createObjectURL(blob);
        const createdAt = Date.now();
        const finalFrame = grabFrameDataUrl();
        const thumbnailUri = finalFrame ?? uri;

        if (finalFrame) {
          recordingFramesRef.current.push(finalFrame);
        }

        addCapture({
          id: `vid-${createdAt}`,
          kind: 'video',
          source: 'video',
          sessionId,
          frameIndex: null,
          intervalSec: null,
          uri,
          thumbnailUri,
          createdAt,
        });

        const frames = sampleImageFrames(
          recordingFramesRef.current,
          MAX_VIDEO_ANALYSIS_FRAMES
        );
        recordingFramesRef.current = [];

        if (frames.length > 0) {
          void runBullionAnalysis(frames, { source: 'video' });
        }

        setRecording(false);
        recorderRef.current = null;
      };

      recorder.start(1000);
      setRecording(true);
      startFrameCapture(sessionId);
    } catch {
      setRecording(false);
      recorderRef.current = null;
      stopFrameCapture();
      recordingFramesRef.current = [];
    }
  };

  const toggleRecording = () => {
    if (recording) {
      stopRecording();
      return;
    }
    startRecording();
  };

  const deleteCapture = (id) => {
    setCaptures((current) => {
      const target = current.find((item) => item.id === id);
      if (target) {
        forgetUrl(target.uri);
        if (target.thumbnailUri !== target.uri) {
          forgetUrl(target.thumbnailUri);
        }
      }
      return current.filter((item) => item.id !== id);
    });
    setSelectedId((current) => (current === id ? null : current));
  };

  const saveCapture = (item) => {
    if (!item) return;
    const stamp = new Date(item.createdAt).toISOString().replace(/[:.]/g, '-');
    if (item.kind === 'video') {
      downloadUri(item.uri, `serphint-video-${stamp}.webm`);
      return;
    }
    const label =
      item.source === 'interval' && item.frameIndex != null
        ? `frame-${String(item.frameIndex).padStart(3, '0')}`
        : 'photo';
    downloadUri(item.uri, `serphint-${label}-${stamp}.jpg`);
  };

  const statusCaption =
    bullionStatus === 'analyzing'
      ? bullionPhase === 'reasoning'
        ? 'Reasoning…'
        : isEnsemble
          ? 'Analyzing…'
          : 'Identifying…'
      : bullionStatus === 'error'
        ? 'Failed'
        : bullionStatus === 'ready'
          ? bullionSource
            ? `Ready · ${bullionSource}`
            : 'Ready'
          : null;

  return (
    <View style={styles.screen}>
      <View style={[styles.layout, stacked && styles.layoutStacked]}>
        <View style={[styles.previewPane, stacked && styles.previewPaneStacked]}>
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
                    backgroundColor: '#0a0a0a',
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
                    ? 'Allow webcam access in your browser settings, then try again.'
                    : cameraState === 'unsupported'
                      ? 'Open this app in a browser that supports webcam capture.'
                      : 'Grant permission when prompted to preview the webcam.'}
                </Text>
                {(cameraState === 'denied' ||
                  cameraState === 'idle' ||
                  cameraState === 'unsupported') && (
                  <Pressable style={styles.retryButton} onPress={() => void startCamera()}>
                    <Text style={styles.retryLabel}>Enable Camera</Text>
                  </Pressable>
                )}
              </View>
            ) : (
              <View style={[styles.statusPill, recording && styles.statusPillRec]} pointerEvents="none">
                <View style={[styles.statusDot, recording && styles.statusDotRec]} />
                <Text style={styles.statusPillLabel}>
                  {recording ? formatRecordingTime(recordingSeconds) : 'LIVE'}
                </Text>
              </View>
            )}
          </View>

          {cameraState === 'live' ? (
            <View style={styles.controlsRow}>
              <View style={styles.intervalControl}>
                <Text style={styles.intervalLabel}>Frame</Text>
                <TextInput
                  style={styles.intervalInput}
                  value={frameIntervalSec}
                  onChangeText={(value) => {
                    if (value === '' || /^\d{0,3}$/.test(value)) {
                      setFrameIntervalSec(value);
                    }
                  }}
                  keyboardType="number-pad"
                  editable={!recording}
                  accessibilityLabel="Frame interval in seconds"
                />
                <Text style={styles.intervalLabel}>sec</Text>
              </View>

              <View style={styles.shutterCluster}>
                <Pressable
                  style={styles.modeButton}
                  onPress={toggleRecording}
                  accessibilityRole="button"
                  accessibilityLabel={recording ? 'Stop recording' : 'Record video'}
                >
                  <View
                    style={[
                      styles.recordGlyph,
                      recording && styles.recordGlyphStop,
                    ]}
                  />
                </Pressable>

                <Pressable
                  style={[styles.shutterOuter, recording && styles.shutterDisabled]}
                  onPress={() => captureImage({ source: 'photo', analyze: true })}
                  disabled={recording}
                  accessibilityRole="button"
                  accessibilityLabel="Capture photo"
                >
                  <View style={[styles.shutterInner, recording && styles.shutterInnerDisabled]} />
                </Pressable>

                <View style={styles.modeButtonSpacer} />
              </View>

              <View style={styles.controlsSpacer} />
            </View>
          ) : null}

          {captures.length > 0 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.historyRow}
              style={styles.historyStrip}
            >
              {captures.map((item) => (
                <View key={item.id} style={styles.thumbWrap}>
                  <Pressable
                    style={styles.thumbButton}
                    onPress={() => setSelectedId(item.id)}
                    accessibilityLabel={`Open ${item.kind} capture`}
                  >
                    {item.kind === 'image' ||
                    String(item.thumbnailUri).startsWith('data:') ? (
                      <Image
                        source={{ uri: item.thumbnailUri }}
                        style={styles.thumbImage}
                      />
                    ) : (
                      <View style={styles.thumbFallback}>
                        <Ionicons name="videocam" size={14} color="#8a8a8a" />
                      </View>
                    )}
                    <View style={styles.thumbBadge}>
                      <Text style={styles.thumbBadgeLabel}>
                        {item.kind === 'video'
                          ? 'Video'
                          : item.source === 'interval'
                            ? `F${item.frameIndex}`
                            : 'Photo'}
                      </Text>
                    </View>
                  </Pressable>
                  <Pressable
                    style={styles.thumbDelete}
                    onPress={() => deleteCapture(item.id)}
                    accessibilityRole="button"
                    accessibilityLabel={`Delete ${item.kind}`}
                    hitSlop={6}
                  >
                    <Ionicons name="close" size={11} color="#1a1a1a" />
                  </Pressable>
                </View>
              ))}
            </ScrollView>
          ) : (
            <Text style={styles.previewHint}>
              Fill the frame with the weight stamp. Photo works best for gram bars.
            </Text>
          )}

          <View style={styles.resultPanel}>
            <View style={styles.aiLabelRow}>
              <Text style={styles.resultHeading}>Result</Text>
              {bullionStatus === 'analyzing' || bullionElapsedMs > 0 ? (
                <Text
                  style={[
                    styles.analysisTimer,
                    bullionStatus === 'analyzing' && styles.analysisTimerLive,
                  ]}
                >
                  {bullionStatus === 'analyzing'
                    ? bullionPhase === 'reasoning'
                      ? 'Reasoning '
                      : 'Analyzing '
                    : 'Took '}
                  {formatElapsed(bullionElapsedMs)}
                </Text>
              ) : statusCaption ? (
                <Text style={styles.analysisTimer}>{statusCaption}</Text>
              ) : null}
            </View>

            {bullionStatus === 'idle' ? (
              <Text style={styles.aiPlaceholder}>
                Capture a photo, record a short video, or upload an image to identify bullion.
              </Text>
            ) : bullionStatus === 'error' ? (
              <Text style={styles.aiErrorText}>{bullionError}</Text>
            ) : (
              <ScrollView
                style={styles.resultScroll}
                contentContainerStyle={styles.resultScrollContent}
                showsVerticalScrollIndicator={false}
              >
                {bullionVotes.length > 0 && isEnsemble ? (
                  <View style={styles.voteSection}>
                    <Text style={styles.voteSectionLabel}>Workers</Text>
                    {bullionVotes.map((vote) => (
                      <View key={vote.model} style={styles.voteCard}>
                        <View style={styles.voteCardHeader}>
                          <Text style={styles.voteCardTitle}>{vote.label}</Text>
                          <Text style={styles.voteCardStatus}>
                            {vote.status === 'analyzing'
                              ? '…'
                              : vote.status === 'ready'
                                ? formatElapsed(vote.elapsedMs)
                                : vote.status === 'error'
                                  ? 'Error'
                                  : vote.status}
                          </Text>
                        </View>
                        {vote.status === 'error' ? (
                          <Text style={styles.aiErrorText}>{vote.error}</Text>
                        ) : vote.status === 'analyzing' ? (
                          <Text style={styles.aiPlaceholder}>Identifying…</Text>
                        ) : vote.items?.length > 0 ? (
                          vote.items.map((item) => (
                            <Text key={item.id} style={styles.voteCardLine}>
                              {item.quantity}× {item.bullion} · {item.weight} · {item.metal}
                            </Text>
                          ))
                        ) : (
                          <Text style={styles.voteCardLine}>
                            {vote.raw || 'No structured items'}
                          </Text>
                        )}
                      </View>
                    ))}
                  </View>
                ) : null}

                {bullionPhase === 'reasoning' ? (
                  <Text style={styles.aiPlaceholder}>
                    {bullionText || 'Reasoning final answer…'}
                  </Text>
                ) : null}

                {bullionStatus === 'analyzing' && bullionPhase !== 'reasoning' ? (
                  <Text style={styles.aiPlaceholder}>
                    {isEnsemble
                      ? 'Workers identifying bullion…'
                      : 'Identifying bullion…'}
                  </Text>
                ) : null}

                {bullionStatus === 'ready' ? (
                  <View style={styles.voteSection}>
                    {isEnsemble || bullionVotes.length > 0 ? (
                      <Text style={styles.voteSectionLabel}>
                        {isEnsemble
                          ? `Final · ${reasonerMeta?.label || 'Reasoner'}`
                          : singleModelMeta?.label || 'Result'}
                        {bullionSource ? ` · ${bullionSource}` : ''}
                      </Text>
                    ) : null}
                    {bullionItems.length > 0 ? (
                      bullionItems.map((item) => (
                        <View key={item.id} style={styles.resultRow}>
                          <Text style={styles.resultTitle}>{item.bullion}</Text>
                          <Text style={styles.resultMeta}>
                            {item.quantity}× · {item.weight} · {item.metal} · {item.brandMint}
                          </Text>
                        </View>
                      ))
                    ) : (
                      <Text style={styles.aiResultText}>
                        {bullionText || 'Could not identify bullion.'}
                      </Text>
                    )}
                  </View>
                ) : null}
              </ScrollView>
            )}
          </View>
        </View>

        <ScrollView
          style={[styles.sidePane, stacked && styles.sidePaneStacked]}
          contentContainerStyle={styles.sidePaneContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.settingsGroup}>
            <Text style={styles.groupTitle}>Mode</Text>
            <View style={styles.segmented}>
              <Pressable
                style={[styles.segment, !isEnsemble && styles.segmentActive]}
                onPress={() => {
                  setAnalysisMode('single');
                  setWorkerMenuOpen(false);
                  setReasonerMenuOpen(false);
                }}
              >
                <Text style={[styles.segmentText, !isEnsemble && styles.segmentTextActive]}>
                  Single
                </Text>
              </Pressable>
              <Pressable
                style={[styles.segment, isEnsemble && styles.segmentActive]}
                onPress={() => {
                  setAnalysisMode('ensemble');
                  setSingleMenuOpen(false);
                }}
              >
                <Text style={[styles.segmentText, isEnsemble && styles.segmentTextActive]}>
                  Ensemble
                </Text>
              </Pressable>
            </View>
          </View>

          {!isEnsemble ? (
            <View style={styles.settingsGroup}>
              <Text style={styles.groupTitle}>Model</Text>
              <View style={styles.modelDropdownWrap}>
                <Pressable
                  style={[styles.modelDropdown, singleMenuOpen && styles.modelDropdownOpen]}
                  onPress={() => {
                    setSingleMenuOpen((open) => !open);
                    setWorkerMenuOpen(false);
                    setReasonerMenuOpen(false);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Select model"
                >
                  <View style={styles.modelDropdownMain}>
                    <Text style={styles.modelDropdownValue} numberOfLines={1}>
                      {singleModelMeta?.label ?? 'Select model'}
                    </Text>
                    {singleModelMeta ? (
                      <Text style={styles.modelDropdownMeta} numberOfLines={1}>
                        {modelOptionMetaLine(singleModelMeta)}
                      </Text>
                    ) : null}
                  </View>
                  <Ionicons
                    name={singleMenuOpen ? 'chevron-up' : 'chevron-down'}
                    size={15}
                    color="#8a8a8a"
                  />
                </Pressable>

                {singleMenuOpen ? (
                  <ScrollView style={styles.modelMenu} nestedScrollEnabled>
                    {MODEL_OPTIONS.map((option) => {
                      const active = option.key === singleModel;
                      return (
                        <Pressable
                          key={option.key}
                          style={[styles.modelOption, active && styles.modelOptionActive]}
                          onPress={() => {
                            setSingleModel(option.key);
                            setSingleMenuOpen(false);
                          }}
                        >
                          <View style={styles.modelOptionCopy}>
                            <View style={styles.modelOptionHeader}>
                              <Text
                                style={[
                                  styles.modelOptionText,
                                  active && styles.modelOptionTextActive,
                                ]}
                              >
                                {option.label}
                              </Text>
                              {active ? (
                                <Ionicons name="checkmark" size={16} color={ACCENT} />
                              ) : null}
                            </View>
                            <Text style={styles.modelOptionStats}>
                              {modelOptionMetaLine(option)}
                            </Text>
                            {option.blurb ? (
                              <Text style={styles.modelOptionBlurb}>{option.blurb}</Text>
                            ) : null}
                          </View>
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                ) : null}
              </View>
            </View>
          ) : (
            <>
              <View style={styles.settingsGroup}>
                <Text style={styles.groupTitle}>Workers</Text>
                <View style={styles.modelDropdownWrap}>
                  <Pressable
                    style={[styles.modelDropdown, workerMenuOpen && styles.modelDropdownOpen]}
                    onPress={() => {
                      setWorkerMenuOpen((open) => !open);
                      setReasonerMenuOpen(false);
                      setSingleMenuOpen(false);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel="Select worker models"
                  >
                    <View style={styles.modelDropdownMain}>
                      <Text style={styles.modelDropdownValue} numberOfLines={1}>
                        {workerSummary}
                      </Text>
                      <Text style={styles.modelDropdownMeta} numberOfLines={1}>
                        {selectedWorkers.map((model) => model.label).join(', ') || 'None selected'}
                      </Text>
                    </View>
                    <Ionicons
                      name={workerMenuOpen ? 'chevron-up' : 'chevron-down'}
                      size={15}
                      color="#8a8a8a"
                    />
                  </Pressable>

                  {workerMenuOpen ? (
                    <ScrollView style={styles.modelMenu} nestedScrollEnabled>
                      {MODEL_OPTIONS.map((option) => {
                        const active = selectedWorkerKeys.includes(option.key);
                        return (
                          <Pressable
                            key={option.key}
                            style={[styles.modelOption, active && styles.modelOptionActive]}
                            onPress={() => toggleWorkerModel(option.key)}
                          >
                            <View style={styles.modelOptionCopy}>
                              <View style={styles.modelOptionHeader}>
                                <Text
                                  style={[
                                    styles.modelOptionText,
                                    active && styles.modelOptionTextActive,
                                  ]}
                                >
                                  {option.label}
                                </Text>
                                <Ionicons
                                  name={active ? 'checkmark-circle' : 'ellipse-outline'}
                                  size={18}
                                  color={active ? ACCENT : '#c4c4c4'}
                                />
                              </View>
                              <Text style={styles.modelOptionStats}>
                                {modelOptionMetaLine(option)}
                              </Text>
                              {option.blurb ? (
                                <Text style={styles.modelOptionBlurb}>{option.blurb}</Text>
                              ) : null}
                            </View>
                          </Pressable>
                        );
                      })}
                    </ScrollView>
                  ) : null}
                </View>
              </View>

              <View style={styles.settingsGroup}>
                <Text style={styles.groupTitle}>Reasoner</Text>
                <View style={styles.modelDropdownWrap}>
                  <Pressable
                    style={[styles.modelDropdown, reasonerMenuOpen && styles.modelDropdownOpen]}
                    onPress={() => {
                      setReasonerMenuOpen((open) => !open);
                      setWorkerMenuOpen(false);
                      setSingleMenuOpen(false);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel="Select reasoner model"
                  >
                    <View style={styles.modelDropdownMain}>
                      <Text style={styles.modelDropdownValue} numberOfLines={1}>
                        {reasonerMeta?.label ?? 'Select reasoner'}
                      </Text>
                      {reasonerMeta ? (
                        <Text style={styles.modelDropdownMeta} numberOfLines={1}>
                          {modelOptionMetaLine(reasonerMeta)}
                        </Text>
                      ) : null}
                    </View>
                    <Ionicons
                      name={reasonerMenuOpen ? 'chevron-up' : 'chevron-down'}
                      size={15}
                      color="#8a8a8a"
                    />
                  </Pressable>

                  {reasonerMenuOpen ? (
                    <ScrollView style={styles.modelMenu} nestedScrollEnabled>
                      {REASONER_MODELS.map((option) => {
                        const active = option.key === reasonerModel;
                        return (
                          <Pressable
                            key={option.key}
                            style={[styles.modelOption, active && styles.modelOptionActive]}
                            onPress={() => {
                              setReasonerModel(option.key);
                              setReasonerMenuOpen(false);
                            }}
                          >
                            <View style={styles.modelOptionCopy}>
                              <View style={styles.modelOptionHeader}>
                                <Text
                                  style={[
                                    styles.modelOptionText,
                                    active && styles.modelOptionTextActive,
                                  ]}
                                >
                                  {option.label}
                                </Text>
                                {active ? (
                                  <Ionicons name="checkmark" size={16} color={ACCENT} />
                                ) : null}
                              </View>
                              <Text style={styles.modelOptionStats}>
                                {modelOptionMetaLine(option)}
                              </Text>
                              {option.blurb ? (
                                <Text style={styles.modelOptionBlurb}>{option.blurb}</Text>
                              ) : null}
                            </View>
                          </Pressable>
                        );
                      })}
                    </ScrollView>
                  ) : null}
                </View>
              </View>
            </>
          )}

          <View style={styles.settingsGroup}>
            <Text style={styles.groupTitle}>Upload</Text>
            {Platform.OS === 'web'
              ? createElement('input', {
                  ref: fileInputRef,
                  type: 'file',
                  accept: 'image/*',
                  style: { display: 'none' },
                  onChange: (event) => {
                    const file = event.target.files?.[0];
                    if (file) void handleUploadImage(file);
                  },
                })
              : null}

            {Platform.OS === 'web'
              ? createElement(
                  'div',
                  {
                    onDragEnter: (event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      setDragActive(true);
                    },
                    onDragOver: (event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      setDragActive(true);
                    },
                    onDragLeave: (event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      setDragActive(false);
                    },
                    onDrop: (event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      setDragActive(false);
                      const file = event.dataTransfer?.files?.[0];
                      if (file) void handleUploadImage(file);
                    },
                    onClick: () => {
                      if (!uploadUri) fileInputRef.current?.click();
                    },
                    style: {
                      minHeight: 112,
                      borderWidth: StyleSheet.hairlineWidth,
                      borderStyle: 'solid',
                      borderColor: dragActive ? ACCENT : '#e5e5e5',
                      borderRadius: 12,
                      backgroundColor: dragActive ? '#ECFDF5' : '#f7f7f7',
                      overflow: 'hidden',
                      cursor: uploadUri ? 'default' : 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    },
                    role: 'button',
                    'aria-label': 'Upload bullion image',
                  },
                  uploadUri ? (
                    <View style={styles.uploadPreviewWrap} pointerEvents="box-none">
                      <Image
                        source={{ uri: uploadUri }}
                        style={styles.uploadPreview}
                        resizeMode="contain"
                      />
                      <Pressable
                        style={styles.uploadClear}
                        onPress={clearUpload}
                        accessibilityLabel="Clear uploaded image"
                        hitSlop={8}
                      >
                        <Ionicons name="close" size={13} color="#1a1a1a" />
                      </Pressable>
                      <Pressable
                        style={styles.uploadReplace}
                        onPress={() => fileInputRef.current?.click()}
                        accessibilityLabel="Replace uploaded image"
                      >
                        <Text style={styles.uploadReplaceLabel}>Replace</Text>
                      </Pressable>
                    </View>
                  ) : (
                    <View style={styles.dropZoneInner}>
                      <Text style={styles.dropZoneTitle}>
                        {dragActive ? 'Drop to analyze' : 'Drop image here'}
                      </Text>
                      <Text style={styles.dropZoneHint}>or click to browse</Text>
                    </View>
                  )
                )
              : (
                <View style={styles.dropZone}>
                  <Text style={styles.dropZoneHint}>Image upload is available on web.</Text>
                </View>
              )}
          </View>
        </ScrollView>
      </View>

      <Modal
        visible={selectedCapture != null}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectedId(null)}
      >
        <View style={styles.viewerBackdrop}>
          <View style={styles.viewerCard}>
            <View style={styles.viewerHeader}>
              <Text style={styles.viewerTitle}>
                {selectedCapture?.kind === 'video'
                  ? 'Video capture'
                  : selectedCapture?.source === 'interval'
                    ? `Interval frame ${selectedCapture.frameIndex}`
                    : 'Photo capture'}
              </Text>
              <View style={styles.viewerActions}>
                {selectedCapture ? (
                  <Pressable
                    style={styles.viewerIconButton}
                    onPress={() => saveCapture(selectedCapture)}
                    accessibilityLabel="Save capture"
                  >
                    <Ionicons name="download-outline" size={18} color="#1a1a1a" />
                  </Pressable>
                ) : null}
                {selectedCapture ? (
                  <Pressable
                    style={styles.viewerIconButton}
                    onPress={() => deleteCapture(selectedCapture.id)}
                    accessibilityLabel="Delete capture"
                  >
                    <Ionicons name="trash-outline" size={18} color="#8a8a8a" />
                  </Pressable>
                ) : null}
                <Pressable
                  style={styles.viewerIconButton}
                  onPress={() => setSelectedId(null)}
                  accessibilityLabel="Close"
                >
                  <Ionicons name="close" size={20} color="#1a1a1a" />
                </Pressable>
              </View>
            </View>
            <View style={styles.viewerBody}>
              {selectedCapture?.kind === 'image' ? (
                <Image
                  source={{ uri: selectedCapture.uri }}
                  style={styles.viewerMedia}
                  resizeMode="contain"
                />
              ) : selectedCapture && Platform.OS === 'web' ? (
                createElement('video', {
                  key: selectedCapture.id,
                  src: selectedCapture.uri,
                  controls: true,
                  autoPlay: true,
                  playsInline: true,
                  style: {
                    width: '100%',
                    height: '100%',
                    objectFit: 'contain',
                    backgroundColor: '#111827',
                  },
                })
              ) : null}
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    minHeight: 0,
    marginTop: 8,
  },
  layout: {
    flex: 1,
    minHeight: 0,
    flexDirection: 'row',
    gap: 28,
  },
  layoutStacked: {
    flexDirection: 'column',
    gap: 20,
  },
  previewPane: {
    flex: 1.4,
    minWidth: 0,
    minHeight: 0,
    gap: 12,
  },
  previewPaneStacked: {
    width: '100%',
    flex: 1,
    minHeight: 420,
  },
  previewShell: {
    width: '100%',
    maxWidth: 520,
    aspectRatio: 16 / 9,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#0a0a0a',
    position: 'relative',
    alignSelf: 'flex-start',
  },
  statusPill: {
    position: 'absolute',
    top: 14,
    left: 14,
    zIndex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
  },
  statusPillRec: {
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#34d399',
  },
  statusDotRec: {
    backgroundColor: '#ef4444',
  },
  statusPillLabel: {
    fontFamily,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.6,
    color: '#fff',
    fontVariant: ['tabular-nums'],
  },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    minHeight: 64,
    maxWidth: 520,
  },
  intervalControl: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  intervalLabel: {
    fontFamily,
    fontSize: 13,
    color: '#8a8a8a',
    fontWeight: '500',
  },
  intervalInput: {
    width: 36,
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: '#1a1a1a',
    textAlign: 'center',
    paddingVertical: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#d0d0d0',
    outlineStyle: 'none',
  },
  shutterCluster: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  modeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#d0d0d0',
    backgroundColor: '#fff',
  },
  modeButtonSpacer: {
    width: 32,
    height: 32,
  },
  recordGlyph: {
    width: 11,
    height: 11,
    borderRadius: 6,
    backgroundColor: '#ef4444',
  },
  recordGlyphStop: {
    width: 9,
    height: 9,
    borderRadius: 2,
    backgroundColor: '#ef4444',
  },
  shutterOuter: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 3,
    borderColor: '#1a1a1a',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  shutterDisabled: {
    opacity: 0.35,
  },
  shutterInner: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#1a1a1a',
  },
  shutterInnerDisabled: {
    backgroundColor: '#8a8a8a',
  },
  controlsSpacer: {
    flex: 1,
  },
  previewHint: {
    fontFamily,
    fontSize: 13,
    lineHeight: 18,
    color: '#8a8a8a',
    maxWidth: 520,
  },
  historyStrip: {
    maxHeight: 64,
    maxWidth: 520,
  },
  historyRow: {
    gap: 8,
    alignItems: 'center',
    paddingVertical: 2,
  },
  thumbWrap: {
    width: 88,
    height: 56,
    position: 'relative',
  },
  thumbButton: {
    width: '100%',
    height: '100%',
    overflow: 'hidden',
    backgroundColor: '#f0f0f0',
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e5e5',
    position: 'relative',
  },
  thumbImage: {
    width: '100%',
    height: '100%',
  },
  thumbFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f0f0f0',
  },
  thumbBadge: {
    position: 'absolute',
    left: 5,
    bottom: 5,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.92)',
  },
  thumbBadgeLabel: {
    fontFamily,
    fontSize: 9,
    fontWeight: '600',
    letterSpacing: 0.2,
    color: '#1a1a1a',
  },
  thumbDelete: {
    position: 'absolute',
    top: -4,
    right: -4,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e5e5',
    zIndex: 2,
  },
  resultPanel: {
    flex: 1,
    minHeight: 160,
    gap: 10,
    marginTop: 4,
    paddingTop: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e5e5e5',
  },
  resultHeading: {
    fontFamily,
    fontSize: 20,
    fontWeight: '600',
    color: '#1a1a1a',
    letterSpacing: -0.4,
  },
  resultScroll: {
    flex: 1,
    minHeight: 0,
  },
  resultScrollContent: {
    gap: 12,
    paddingBottom: 8,
  },
  resultRow: {
    gap: 4,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#efefef',
  },
  resultTitle: {
    fontFamily,
    fontSize: 22,
    fontWeight: '600',
    color: '#1a1a1a',
    letterSpacing: -0.4,
  },
  resultMeta: {
    fontFamily,
    fontSize: 15,
    lineHeight: 21,
    color: '#6b6b6b',
  },
  sidePane: {
    flex: 0.85,
    minWidth: 260,
    maxWidth: 340,
    minHeight: 0,
  },
  sidePaneStacked: {
    width: '100%',
    maxWidth: '100%',
    minWidth: 0,
    flex: 1,
  },
  sidePaneContent: {
    gap: 20,
    paddingBottom: 24,
  },
  settingsGroup: {
    gap: 8,
  },
  groupTitle: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: '#8a8a8a',
    letterSpacing: -0.1,
  },
  segmented: {
    flexDirection: 'row',
    backgroundColor: '#f0f0f0',
    borderRadius: 9,
    padding: 2,
  },
  segment: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    borderRadius: 7,
  },
  segmentActive: {
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
  },
  segmentText: {
    fontFamily,
    fontSize: 13,
    fontWeight: '500',
    color: '#6b6b6b',
  },
  segmentTextActive: {
    color: '#1a1a1a',
    fontWeight: '600',
  },
  modelDropdownWrap: {
    position: 'relative',
    zIndex: 5,
  },
  modelDropdown: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e5e5',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: '#f7f7f7',
  },
  modelDropdownOpen: {
    borderColor: '#d0d0d0',
    backgroundColor: '#fff',
  },
  modelDropdownMain: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  modelDropdownValue: {
    fontFamily,
    fontSize: 15,
    fontWeight: '500',
    color: '#1a1a1a',
    letterSpacing: -0.2,
  },
  modelDropdownMeta: {
    fontFamily,
    fontSize: 11,
    color: '#8a8a8a',
  },
  modelMenu: {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    marginTop: 6,
    maxHeight: 280,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e5e5',
    borderRadius: 12,
    backgroundColor: '#fff',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    zIndex: 20,
  },
  modelOption: {
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f0f0f0',
  },
  modelOptionActive: {
    backgroundColor: '#f7f7f7',
  },
  modelOptionCopy: {
    gap: 3,
  },
  modelOptionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  modelOptionText: {
    fontFamily,
    fontSize: 14,
    color: '#1a1a1a',
    flex: 1,
  },
  modelOptionTextActive: {
    fontWeight: '600',
    color: ACCENT,
  },
  modelOptionStats: {
    fontFamily,
    fontSize: 11,
    color: '#6b6b6b',
  },
  modelOptionBlurb: {
    fontFamily,
    fontSize: 11,
    color: '#8a8a8a',
    lineHeight: 15,
  },
  aiLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  analysisTimer: {
    fontFamily,
    fontSize: 12,
    fontWeight: '500',
    color: '#8a8a8a',
    fontVariant: ['tabular-nums'],
  },
  analysisTimerLive: {
    color: ACCENT,
  },
  dropZone: {
    minHeight: 112,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e5e5',
    borderRadius: 12,
    backgroundColor: '#f7f7f7',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dropZoneInner: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingHorizontal: 20,
    paddingVertical: 24,
  },
  dropZoneTitle: {
    fontFamily,
    fontSize: 14,
    fontWeight: '500',
    color: '#1a1a1a',
    textAlign: 'center',
  },
  dropZoneHint: {
    fontFamily,
    fontSize: 12,
    color: '#8a8a8a',
    textAlign: 'center',
  },
  uploadPreviewWrap: {
    width: '100%',
    height: 140,
    position: 'relative',
    backgroundColor: '#0a0a0a',
  },
  uploadPreview: {
    width: '100%',
    height: '100%',
  },
  uploadClear: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    zIndex: 2,
  },
  uploadReplace: {
    position: 'absolute',
    left: 8,
    bottom: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.92)',
    zIndex: 2,
  },
  uploadReplaceLabel: {
    fontFamily,
    fontSize: 12,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  voteSection: {
    gap: 8,
  },
  voteSectionLabel: {
    fontFamily,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
    color: '#8a8a8a',
  },
  voteCard: {
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#f7f7f7',
    gap: 4,
  },
  voteCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  voteCardTitle: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: '#1a1a1a',
    flex: 1,
  },
  voteCardStatus: {
    fontFamily,
    fontSize: 11,
    color: '#8a8a8a',
    fontVariant: ['tabular-nums'],
  },
  voteCardLine: {
    fontFamily,
    fontSize: 12,
    lineHeight: 17,
    color: '#3f3f3f',
  },
  aiPlaceholder: {
    fontFamily,
    fontSize: 14,
    lineHeight: 20,
    color: '#8a8a8a',
  },
  aiResultText: {
    fontFamily,
    fontSize: 14,
    lineHeight: 21,
    color: '#1a1a1a',
    fontWeight: '500',
  },
  aiErrorText: {
    fontFamily,
    fontSize: 13,
    lineHeight: 19,
    color: '#b91c1c',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    backgroundColor: 'rgba(10, 10, 10, 0.92)',
    gap: 10,
  },
  overlayTitle: {
    fontFamily,
    fontSize: 17,
    fontWeight: '600',
    color: '#fff',
    textAlign: 'center',
    letterSpacing: -0.2,
  },
  overlayBody: {
    fontFamily,
    fontSize: 13,
    lineHeight: 18,
    color: '#a3a3a3',
    textAlign: 'center',
    maxWidth: 300,
  },
  retryButton: {
    marginTop: 6,
    paddingHorizontal: 18,
    paddingVertical: 10,
    backgroundColor: '#fff',
    borderRadius: 980,
  },
  retryLabel: {
    fontFamily,
    fontSize: 14,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  viewerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  viewerCard: {
    width: '100%',
    maxWidth: 760,
    height: '80%',
    maxHeight: 560,
    backgroundColor: '#fff',
    borderRadius: 16,
    overflow: 'hidden',
  },
  viewerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#efefef',
  },
  viewerTitle: {
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: '#1a1a1a',
    letterSpacing: -0.2,
  },
  viewerActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  viewerIconButton: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewerBody: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  viewerMedia: {
    width: '100%',
    height: '100%',
  },
});
