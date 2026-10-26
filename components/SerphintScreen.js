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
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
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
import { CANVAS, NAV_TAB_ACTIVE_BG, useIsMobile } from '../lib/mobileUi';
import { useScreenVisible } from '../lib/screenVisibility';
import { FONT } from '../lib/typography';
import { getVideoElement, useWebcam } from '../lib/webcam';

const INK = '#1a1a1a';
const SECONDARY = '#8e8e93';
const CHIP_BORDER = '#d0d0d0';
const CHIP_RADIUS = 8;
const HAIRLINE = 'rgba(42,38,30,0.08)';
const HOVER_WASH = 'rgba(60,60,67,0.06)';
const PRESS_WASH = 'rgba(60,60,67,0.10)';
const WELL = 'rgba(60,60,67,0.06)';
const GREEN = '#1F8A4E';
const RED = '#B91C1C';
const CHIP_SHADOW = Platform.select({
  web: { boxShadow: '0 1px 2px rgba(0,0,0,0.05)' },
  default: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 2,
    elevation: 1,
  },
});
const webCursor = Platform.select({ web: { cursor: 'pointer' }, default: {} });

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

const CAMERA_CONSTRAINTS = [
  {
    video: {
      facingMode: 'user',
      width: { ideal: 1280 },
      height: { ideal: 720 },
      aspectRatio: { ideal: 16 / 9 },
    },
    audio: true,
  },
  {
    video: {
      facingMode: 'user',
      width: { ideal: 1280 },
      height: { ideal: 720 },
      aspectRatio: { ideal: 16 / 9 },
    },
    audio: false,
  },
];

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

function ChipPressable({ style, hoverStyle, pressStyle, children, ...props }) {
  return (
    <Pressable
      {...props}
      style={({ hovered, pressed }) => [
        style,
        hovered && (hoverStyle === undefined ? styles.washHover : hoverStyle),
        pressed && (pressStyle === undefined ? styles.washPress : pressStyle),
      ]}
    >
      {children}
    </Pressable>
  );
}

function ModelMenu({
  open,
  valueLabel,
  valueMeta,
  accessibilityLabel,
  onToggle,
  options,
  isSelected,
  onChoose,
  multi = false,
}) {
  return (
    <View style={styles.modelDropdownWrap}>
      <ChipPressable
        style={[styles.modelDropdown, open && styles.modelDropdownOpen]}
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
      >
        <View style={styles.modelDropdownMain}>
          <Text style={styles.modelDropdownValue} numberOfLines={1}>
            {valueLabel}
          </Text>
          {valueMeta ? (
            <Text style={styles.modelDropdownMeta} numberOfLines={1}>
              {valueMeta}
            </Text>
          ) : null}
        </View>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={15} color={SECONDARY} />
      </ChipPressable>
      {open ? (
        <ScrollView style={styles.modelMenu} nestedScrollEnabled>
          {options.map((option) => {
            const active = isSelected(option.key);
            return (
              <ChipPressable
                key={option.key}
                style={[styles.modelOption, active && styles.modelOptionActive]}
                hoverStyle={styles.modelOptionHover}
                onPress={() => onChoose(option.key)}
              >
                <View style={styles.modelOptionCopy}>
                  <View style={styles.modelOptionHeader}>
                    <Text
                      style={[styles.modelOptionText, active && styles.modelOptionTextActive]}
                    >
                      {option.label}
                    </Text>
                    {multi ? (
                      <Ionicons
                        name={active ? 'checkmark-circle' : 'ellipse-outline'}
                        size={18}
                        color={active ? GREEN : '#c7c7cc'}
                      />
                    ) : active ? (
                      <Ionicons name="checkmark" size={16} color={GREEN} />
                    ) : null}
                  </View>
                  <Text style={styles.modelOptionStats}>{modelOptionMetaLine(option)}</Text>
                  {option.blurb ? (
                    <Text style={styles.modelOptionBlurb}>{option.blurb}</Text>
                  ) : null}
                </View>
              </ChipPressable>
            );
          })}
        </ScrollView>
      ) : null}
    </View>
  );
}

export default function SerphintScreen() {
  const isMobile = useIsMobile();
  const screenVisible = useScreenVisible();
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
  const { videoRef, streamRef, cameraState, startCamera, stopStream: stopWebcam, setVideoNode } = useWebcam({
    active: screenVisible,
    autoStart: true,
    constraints: CAMERA_CONSTRAINTS,
  });

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
    stopWebcam();
  };

  useEffect(() => {
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
    const video = getVideoElement(videoRef.current);
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
  const previewColumn = (
        <View style={[styles.previewPane, isMobile && styles.previewPaneStacked]}>
          <View style={styles.cameraCard}>
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
                    <ChipPressable
                      style={styles.retryButton}
                      hoverStyle={styles.retryButtonHover}
                      pressStyle={styles.retryButtonPress}
                      onPress={() => void startCamera()}
                    >
                      <Text style={styles.retryLabel}>Enable camera</Text>
                    </ChipPressable>
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
                  <ChipPressable
                    style={styles.modeButton}
                    onPress={toggleRecording}
                    accessibilityRole="button"
                    accessibilityLabel={recording ? 'Stop recording' : 'Record video'}
                  >
                    <View style={[styles.recordGlyph, recording && styles.recordGlyphStop]} />
                  </ChipPressable>

                  <ChipPressable
                    style={[styles.shutterOuter, recording && styles.shutterDisabled]}
                    hoverStyle={styles.shutterOuterHover}
                    pressStyle={styles.shutterOuterPress}
                    onPress={() => captureImage({ source: 'photo', analyze: true })}
                    disabled={recording}
                    accessibilityRole="button"
                    accessibilityLabel="Capture photo"
                  >
                    <View style={[styles.shutterInner, recording && styles.shutterInnerDisabled]} />
                  </ChipPressable>

                  <View style={styles.modeButtonSpacer} />
                </View>

                <View style={styles.controlsSpacer} />
              </View>
            ) : null}
          </View>

          {captures.length > 0 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.historyRow}
              style={styles.historyStrip}
            >
              {captures.map((item) => (
                <View key={item.id} style={styles.thumbWrap}>
                  <ChipPressable
                    style={styles.thumbButton}
                    onPress={() => setSelectedId(item.id)}
                    accessibilityLabel={`Open ${item.kind} capture`}
                  >
                    {item.kind === 'image' || String(item.thumbnailUri).startsWith('data:') ? (
                      <Image source={{ uri: item.thumbnailUri }} style={styles.thumbImage} />
                    ) : (
                      <View style={styles.thumbFallback}>
                        <Ionicons name="videocam" size={14} color={SECONDARY} />
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
                  </ChipPressable>
                  <ChipPressable
                    style={styles.thumbDelete}
                    onPress={() => deleteCapture(item.id)}
                    accessibilityRole="button"
                    accessibilityLabel={`Delete ${item.kind}`}
                    hitSlop={6}
                  >
                    <Ionicons name="close" size={11} color={INK} />
                  </ChipPressable>
                </View>
              ))}
            </ScrollView>
          ) : (
            <Text style={styles.previewHint}>
              Fill the frame with the weight stamp. Photo works best for gram bars.
            </Text>
          )}

          <View style={[styles.resultCard, isMobile && styles.resultCardMobile]}>
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
                    {isEnsemble ? 'Workers identifying bullion…' : 'Identifying bullion…'}
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
                      bullionItems.map((item, index) => (
                        <View
                          key={item.id}
                          style={[
                            styles.resultRow,
                            index === bullionItems.length - 1 && styles.resultRowLast,
                          ]}
                        >
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
  );

  const settingsColumn = (
        <ScrollView
          style={[styles.sidePane, isMobile && styles.sidePaneStacked]}
          contentContainerStyle={styles.sidePaneContent}
          showsVerticalScrollIndicator={false}
          scrollEnabled={!isMobile}
        >
          <View style={styles.settingsCard}>
            <View style={styles.settingsGroup}>
              <Text style={styles.groupTitle}>Mode</Text>
              <View style={styles.segmented}>
                  <ChipPressable
                    style={[styles.segment, !isEnsemble && styles.segmentActive]}
                    hoverStyle={isEnsemble ? styles.washHover : null}
                    onPress={() => {
                      setAnalysisMode('single');
                      setWorkerMenuOpen(false);
                      setReasonerMenuOpen(false);
                    }}
                  >
                    <Text style={[styles.segmentText, !isEnsemble && styles.segmentTextActive]}>
                      Single
                    </Text>
                  </ChipPressable>
                  <ChipPressable
                    style={[styles.segment, isEnsemble && styles.segmentActive]}
                    hoverStyle={!isEnsemble ? styles.washHover : null}
                    onPress={() => {
                      setAnalysisMode('ensemble');
                      setSingleMenuOpen(false);
                    }}
                  >
                  <Text style={[styles.segmentText, isEnsemble && styles.segmentTextActive]}>
                    Ensemble
                  </Text>
                </ChipPressable>
              </View>
            </View>

            {!isEnsemble ? (
              <View style={styles.settingsGroup}>
                <Text style={styles.groupTitle}>Model</Text>
                <ModelMenu
                  open={singleMenuOpen}
                  valueLabel={singleModelMeta?.label ?? 'Select model'}
                  valueMeta={singleModelMeta ? modelOptionMetaLine(singleModelMeta) : null}
                  accessibilityLabel="Select model"
                  onToggle={() => {
                    setSingleMenuOpen((open) => !open);
                    setWorkerMenuOpen(false);
                    setReasonerMenuOpen(false);
                  }}
                  options={MODEL_OPTIONS}
                  isSelected={(key) => key === singleModel}
                  onChoose={(key) => {
                    setSingleModel(key);
                    setSingleMenuOpen(false);
                  }}
                />
              </View>
            ) : (
              <>
                <View style={styles.settingsGroup}>
                  <Text style={styles.groupTitle}>Workers</Text>
                  <ModelMenu
                    open={workerMenuOpen}
                    valueLabel={workerSummary}
                    valueMeta={
                      selectedWorkers.map((model) => model.label).join(', ') || 'None selected'
                    }
                    accessibilityLabel="Select worker models"
                    onToggle={() => {
                      setWorkerMenuOpen((open) => !open);
                      setReasonerMenuOpen(false);
                      setSingleMenuOpen(false);
                    }}
                    options={MODEL_OPTIONS}
                    isSelected={(key) => selectedWorkerKeys.includes(key)}
                    onChoose={toggleWorkerModel}
                    multi
                  />
                </View>

                <View style={styles.settingsGroup}>
                  <Text style={styles.groupTitle}>Reasoner</Text>
                  <ModelMenu
                    open={reasonerMenuOpen}
                    valueLabel={reasonerMeta?.label ?? 'Select reasoner'}
                    valueMeta={reasonerMeta ? modelOptionMetaLine(reasonerMeta) : null}
                    accessibilityLabel="Select reasoner model"
                    onToggle={() => {
                      setReasonerMenuOpen((open) => !open);
                      setWorkerMenuOpen(false);
                      setSingleMenuOpen(false);
                    }}
                    options={REASONER_MODELS}
                    isSelected={(key) => key === reasonerModel}
                    onChoose={(key) => {
                      setReasonerModel(key);
                      setReasonerMenuOpen(false);
                    }}
                  />
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
                        minHeight: 120,
                        borderWidth: 1,
                        borderStyle: uploadUri ? 'solid' : 'dashed',
                        borderColor: dragActive ? INK : CHIP_BORDER,
                        borderRadius: CHIP_RADIUS,
                        backgroundColor: dragActive ? HOVER_WASH : WELL,
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
                        <ChipPressable
                          style={styles.uploadClear}
                          onPress={clearUpload}
                          accessibilityLabel="Clear uploaded image"
                          hitSlop={8}
                        >
                          <Ionicons name="close" size={13} color={INK} />
                        </ChipPressable>
                        <ChipPressable
                          style={styles.uploadReplace}
                          onPress={() => fileInputRef.current?.click()}
                          accessibilityLabel="Replace uploaded image"
                        >
                          <Text style={styles.uploadReplaceLabel}>Replace</Text>
                        </ChipPressable>
                      </View>
                    ) : (
                      <View style={styles.dropZoneInner}>
                        <Ionicons
                          name={dragActive ? 'image' : 'image-outline'}
                          size={22}
                          color={dragActive ? INK : SECONDARY}
                        />
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
          </View>
        </ScrollView>
  );

  return (
    <View style={[styles.screen, isMobile && styles.screenMobile]}>
      {isMobile ? (
        <ScrollView
          style={styles.mobileScroll}
          contentContainerStyle={styles.layoutStacked}
          showsVerticalScrollIndicator={false}
        >
          {previewColumn}
          {settingsColumn}
        </ScrollView>
      ) : (
        <View style={styles.layout}>
          {previewColumn}
          {settingsColumn}
        </View>
      )}

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
                  <ChipPressable
                    style={styles.viewerIconButton}
                    onPress={() => saveCapture(selectedCapture)}
                    accessibilityLabel="Save capture"
                  >
                    <Ionicons name="download-outline" size={18} color={INK} />
                  </ChipPressable>
                ) : null}
                {selectedCapture ? (
                  <ChipPressable
                    style={styles.viewerIconButton}
                    onPress={() => deleteCapture(selectedCapture.id)}
                    accessibilityLabel="Delete capture"
                  >
                    <Ionicons name="trash-outline" size={18} color={SECONDARY} />
                  </ChipPressable>
                ) : null}
                <ChipPressable
                  style={styles.viewerIconButton}
                  onPress={() => setSelectedId(null)}
                  accessibilityLabel="Close"
                >
                  <Ionicons name="close" size={20} color={INK} />
                </ChipPressable>
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
                    backgroundColor: '#111',
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
    backgroundColor: CANVAS,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 20,
  },
  screenMobile: {
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 16,
  },
  mobileScroll: {
    flex: 1,
    minHeight: 0,
  },
  layout: {
    flex: 1,
    minHeight: 0,
    flexDirection: 'row',
    gap: 16,
  },
  layoutStacked: {
    flexDirection: 'column',
    gap: 12,
  },
  previewPane: {
    flex: 1.4,
    minWidth: 0,
    minHeight: 0,
    gap: 12,
  },
  previewPaneStacked: {
    width: '100%',
    flexGrow: 0,
    flexShrink: 0,
    minHeight: 0,
  },
  cameraCard: {
    backgroundColor: '#fff',
    borderRadius: CHIP_RADIUS,
    borderWidth: 1,
    borderColor: CHIP_BORDER,
    overflow: 'hidden',
    ...CHIP_SHADOW,
  },
  previewShell: {
    width: '100%',
    aspectRatio: 16 / 9,
    overflow: 'hidden',
    backgroundColor: '#111',
    position: 'relative',
  },
  statusPill: {
    position: 'absolute',
    top: 12,
    left: 12,
    zIndex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  statusPillRec: {
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: GREEN,
  },
  statusDotRec: {
    backgroundColor: '#FF3B30',
  },
  statusPillLabel: {
    fontFamily: FONT,
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
    paddingHorizontal: 14,
    paddingVertical: 10,
    minHeight: 64,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: HAIRLINE,
    backgroundColor: '#fff',
  },
  intervalControl: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  intervalLabel: {
    fontFamily: FONT,
    fontSize: 13,
    color: SECONDARY,
    fontWeight: '500',
  },
  intervalInput: {
    width: 40,
    height: 28,
    fontFamily: FONT,
    fontSize: 14,
    fontWeight: '600',
    color: INK,
    textAlign: 'center',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: CHIP_BORDER,
    backgroundColor: WELL,
    outlineStyle: 'none',
  },
  shutterCluster: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  modeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: CHIP_BORDER,
    backgroundColor: '#fff',
    ...CHIP_SHADOW,
    ...webCursor,
  },
  modeButtonSpacer: {
    width: 32,
    height: 32,
  },
  recordGlyph: {
    width: 11,
    height: 11,
    borderRadius: 6,
    backgroundColor: '#FF3B30',
  },
  recordGlyphStop: {
    width: 9,
    height: 9,
    borderRadius: 2,
    backgroundColor: '#FF3B30',
  },
  shutterOuter: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 2,
    borderColor: INK,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    ...webCursor,
  },
  shutterOuterHover: {
    backgroundColor: HOVER_WASH,
  },
  shutterOuterPress: {
    backgroundColor: PRESS_WASH,
  },
  shutterDisabled: {
    opacity: 0.35,
  },
  shutterInner: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: INK,
  },
  shutterInnerDisabled: {
    backgroundColor: SECONDARY,
  },
  controlsSpacer: {
    flex: 1,
  },
  previewHint: {
    fontFamily: FONT,
    fontSize: 13,
    lineHeight: 18,
    color: SECONDARY,
  },
  historyStrip: {
    maxHeight: 68,
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
    backgroundColor: NAV_TAB_ACTIVE_BG,
    borderRadius: CHIP_RADIUS,
    borderWidth: 1,
    borderColor: CHIP_BORDER,
    position: 'relative',
    ...webCursor,
  },
  thumbImage: {
    width: '100%',
    height: '100%',
  },
  thumbFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: NAV_TAB_ACTIVE_BG,
  },
  thumbBadge: {
    position: 'absolute',
    left: 5,
    bottom: 5,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.94)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: HAIRLINE,
  },
  thumbBadgeLabel: {
    fontFamily: FONT,
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: -0.1,
    color: INK,
  },
  thumbDelete: {
    position: 'absolute',
    top: -5,
    right: -5,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: CHIP_BORDER,
    zIndex: 2,
    ...CHIP_SHADOW,
    ...webCursor,
  },
  resultCard: {
    flex: 1,
    minHeight: 160,
    backgroundColor: '#fff',
    borderRadius: CHIP_RADIUS,
    borderWidth: 1,
    borderColor: CHIP_BORDER,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
    ...CHIP_SHADOW,
  },
  resultCardMobile: {
    flexGrow: 0,
    flexShrink: 0,
    minHeight: 0,
  },
  resultHeading: {
    fontFamily: FONT,
    fontSize: 13,
    fontWeight: '600',
    color: SECONDARY,
    letterSpacing: -0.1,
  },
  resultScroll: {
    flex: 1,
    minHeight: 0,
  },
  resultScrollContent: {
    gap: 12,
    paddingBottom: 4,
  },
  resultRow: {
    gap: 3,
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: HAIRLINE,
  },
  resultRowLast: {
    borderBottomWidth: 0,
    paddingBottom: 2,
  },
  resultTitle: {
    fontFamily: FONT,
    fontSize: 16,
    fontWeight: '600',
    color: INK,
    letterSpacing: -0.3,
  },
  resultMeta: {
    fontFamily: FONT,
    fontSize: 13,
    lineHeight: 18,
    color: SECONDARY,
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
    flexGrow: 0,
    flexShrink: 0,
  },
  sidePaneContent: {
    gap: 12,
    paddingBottom: 8,
  },
  settingsCard: {
    backgroundColor: '#fff',
    borderRadius: CHIP_RADIUS,
    borderWidth: 1,
    borderColor: CHIP_BORDER,
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 18,
    ...CHIP_SHADOW,
  },
  settingsGroup: {
    gap: 8,
  },
  groupTitle: {
    fontFamily: FONT,
    fontSize: 12,
    fontWeight: '600',
    color: SECONDARY,
    letterSpacing: 0.2,
    textTransform: 'uppercase',
  },
  segmented: {
    flexDirection: 'row',
    backgroundColor: WELL,
    borderRadius: CHIP_RADIUS,
    padding: 2,
  },
  segment: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    borderRadius: 6,
    ...webCursor,
  },
  segmentActive: {
    backgroundColor: '#fff',
    ...CHIP_SHADOW,
  },
  segmentText: {
    fontFamily: FONT,
    fontSize: 13,
    fontWeight: '500',
    color: SECONDARY,
  },
  segmentTextActive: {
    color: INK,
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
    borderWidth: 1,
    borderColor: CHIP_BORDER,
    borderRadius: CHIP_RADIUS,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#fff',
    ...CHIP_SHADOW,
    ...webCursor,
  },
  modelDropdownOpen: {
    backgroundColor: NAV_TAB_ACTIVE_BG,
  },
  modelDropdownMain: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  modelDropdownValue: {
    fontFamily: FONT,
    fontSize: 14,
    fontWeight: '500',
    color: INK,
    letterSpacing: -0.2,
  },
  modelDropdownMeta: {
    fontFamily: FONT,
    fontSize: 11,
    color: SECONDARY,
  },
  modelMenu: {
    marginTop: 6,
    maxHeight: 280,
    borderWidth: 1,
    borderColor: CHIP_BORDER,
    borderRadius: CHIP_RADIUS,
    backgroundColor: '#fff',
    overflow: 'hidden',
    ...CHIP_SHADOW,
  },
  modelOption: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: HAIRLINE,
    ...webCursor,
  },
  modelOptionActive: {
    backgroundColor: NAV_TAB_ACTIVE_BG,
  },
  modelOptionHover: {
    backgroundColor: HOVER_WASH,
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
    fontFamily: FONT,
    fontSize: 14,
    color: INK,
    flex: 1,
  },
  modelOptionTextActive: {
    fontWeight: '600',
    color: INK,
  },
  modelOptionStats: {
    fontFamily: FONT,
    fontSize: 11,
    color: SECONDARY,
  },
  modelOptionBlurb: {
    fontFamily: FONT,
    fontSize: 11,
    color: SECONDARY,
    lineHeight: 15,
  },
  aiLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  analysisTimer: {
    fontFamily: FONT,
    fontSize: 12,
    fontWeight: '500',
    color: SECONDARY,
    fontVariant: ['tabular-nums'],
  },
  analysisTimerLive: {
    color: GREEN,
  },
  dropZone: {
    minHeight: 120,
    borderWidth: 1,
    borderColor: CHIP_BORDER,
    borderStyle: 'dashed',
    borderRadius: CHIP_RADIUS,
    backgroundColor: WELL,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dropZoneInner: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 20,
    paddingVertical: 24,
  },
  dropZoneTitle: {
    fontFamily: FONT,
    fontSize: 14,
    fontWeight: '500',
    color: INK,
    textAlign: 'center',
    letterSpacing: -0.2,
  },
  dropZoneHint: {
    fontFamily: FONT,
    fontSize: 12,
    color: SECONDARY,
    textAlign: 'center',
  },
  uploadPreviewWrap: {
    width: '100%',
    height: 140,
    position: 'relative',
    backgroundColor: '#111',
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
    borderWidth: 1,
    borderColor: CHIP_BORDER,
    zIndex: 2,
    ...CHIP_SHADOW,
    ...webCursor,
  },
  uploadReplace: {
    position: 'absolute',
    left: 8,
    bottom: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: CHIP_BORDER,
    zIndex: 2,
    ...CHIP_SHADOW,
    ...webCursor,
  },
  uploadReplaceLabel: {
    fontFamily: FONT,
    fontSize: 12,
    fontWeight: '600',
    color: INK,
  },
  voteSection: {
    gap: 8,
  },
  voteSectionLabel: {
    fontFamily: FONT,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
    color: SECONDARY,
  },
  voteCard: {
    borderRadius: CHIP_RADIUS,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: WELL,
    gap: 4,
  },
  voteCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  voteCardTitle: {
    fontFamily: FONT,
    fontSize: 13,
    fontWeight: '600',
    color: INK,
    flex: 1,
  },
  voteCardStatus: {
    fontFamily: FONT,
    fontSize: 11,
    color: SECONDARY,
    fontVariant: ['tabular-nums'],
  },
  voteCardLine: {
    fontFamily: FONT,
    fontSize: 12,
    lineHeight: 17,
    color: '#3f3f3f',
  },
  aiPlaceholder: {
    fontFamily: FONT,
    fontSize: 14,
    lineHeight: 20,
    color: SECONDARY,
  },
  aiResultText: {
    fontFamily: FONT,
    fontSize: 14,
    lineHeight: 21,
    color: INK,
    fontWeight: '500',
  },
  aiErrorText: {
    fontFamily: FONT,
    fontSize: 13,
    lineHeight: 19,
    color: RED,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    backgroundColor: 'rgba(17, 17, 17, 0.92)',
    gap: 10,
  },
  overlayTitle: {
    fontFamily: FONT,
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
    textAlign: 'center',
    letterSpacing: -0.2,
  },
  overlayBody: {
    fontFamily: FONT,
    fontSize: 13,
    lineHeight: 18,
    color: '#a3a3a3',
    textAlign: 'center',
    maxWidth: 300,
  },
  retryButton: {
    marginTop: 6,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#fff',
    borderRadius: CHIP_RADIUS,
    borderWidth: 1,
    borderColor: CHIP_BORDER,
    ...CHIP_SHADOW,
    ...webCursor,
  },
  retryButtonHover: {
    backgroundColor: NAV_TAB_ACTIVE_BG,
  },
  retryButtonPress: {
    backgroundColor: PRESS_WASH,
  },
  retryLabel: {
    fontFamily: FONT,
    fontSize: 14,
    fontWeight: '600',
    color: INK,
  },
  viewerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
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
    borderRadius: CHIP_RADIUS,
    borderWidth: 1,
    borderColor: CHIP_BORDER,
    overflow: 'hidden',
    ...CHIP_SHADOW,
  },
  viewerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: HAIRLINE,
  },
  viewerTitle: {
    fontFamily: FONT,
    fontSize: 14,
    fontWeight: '600',
    color: INK,
    letterSpacing: -0.2,
  },
  viewerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  viewerIconButton: {
    width: 34,
    height: 34,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    ...webCursor,
  },
  viewerBody: {
    flex: 1,
    backgroundColor: '#111',
  },
  viewerMedia: {
    width: '100%',
    height: '100%',
  },
  washHover: {
    backgroundColor: HOVER_WASH,
  },
  washPress: {
    backgroundColor: PRESS_WASH,
  },
});
