import { createElement, useEffect, useRef, useState } from 'react';
import * as ImagePicker from 'expo-image-picker';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { assetToDataUrl } from '../lib/avatarCartoon';
import { mobileSafeBottom, mobileSafeTop, useIsMobile } from '../lib/mobileUi';
import {
  batchStoreKey,
  buildDailyReceiptGrid,
  countDailyReceiptPo,
  dailyCellKey,
  placePurchaseOnBatch,
  poDateKey,
} from '../lib/triageDailyReceipts';
import { ERROR_TYPES } from '../lib/triageDraft';
import { lookupPurchasesByPoNumber, normalizePoNumber, readPoNumberFromPhoto } from '../lib/triagePoRead';
import { formatAmount } from '../lib/transactions';
import { ensurePurchaseOnDateBatch, saveTriagePoReview, setTriagePoReceived, triageEditorFromSession, useTransferWorkflow } from '../lib/transferWorkflow';
import { getVideoElement, useWebcam, webcamSupported } from '../lib/webcam';
import { catalogNameForPurchaseLine, fetchWebsitePrices } from '../lib/websitePrices';
import { FONT, T } from './TriageKit';

const PAPER_ASPECT = 8.5 / 11;

const CAMERA_CONSTRAINTS = [
  {
    video: {
      facingMode: { ideal: 'environment' },
      aspectRatio: { ideal: PAPER_ASPECT },
      width: { ideal: 1440 },
      height: { ideal: 1920 },
    },
    audio: false,
  },
  { video: true, audio: false },
];

const PICKER_OPTIONS = {
  mediaTypes: ['images'],
  allowsEditing: false,
  quality: 0.7,
  base64: true,
  cameraType: ImagePicker.CameraType?.back,
};

function prefersDeviceCamera() {
  return Platform.OS !== 'web';
}

function captureFrame(video, { cropPaper = true } = {}) {
  if (!video?.videoWidth || !video?.videoHeight) return null;
  const frameWidth = video.videoWidth;
  const frameHeight = video.videoHeight;
  let sx = 0;
  let sy = 0;
  let sw = frameWidth;
  let sh = frameHeight;
  if (cropPaper) {
    const frameAspect = frameWidth / frameHeight;
    if (frameAspect > PAPER_ASPECT) {
      sw = frameHeight * PAPER_ASPECT;
      sx = (frameWidth - sw) / 2;
    } else if (frameAspect < PAPER_ASPECT) {
      sh = frameWidth / PAPER_ASPECT;
      sy = (frameHeight - sh) / 2;
    }
  }
  const maxW = 1600;
  const scale = Math.min(1, maxW / sw);
  const width = Math.round(sw * scale);
  const height = Math.round(sh * scale);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, width, height);
  return canvas.toDataURL('image/jpeg', 0.85);
}

function lineTitle(line, catalog) {
  const title = catalogNameForPurchaseLine(line, catalog);
  if (/^(gold|silver|platinum)$/i.test(title)) return '…';
  return title;
}

function weightLabel(line) {
  const raw = line?.weight;
  if (raw == null || raw === '') return '';
  const n = Number(raw);
  const shown = Number.isFinite(n)
    ? n.toLocaleString('en-CA', { maximumFractionDigits: 3 })
    : String(raw);
  const unit = String(line?.unitType || '').trim();
  return unit ? `${shown} ${unit}` : shown;
}

function moneyLabel(amount) {
  if (amount == null || !Number.isFinite(Number(amount))) return '—';
  return formatAmount(amount);
}

function actorNameOf(session) {
  return triageEditorFromSession(session)?.name || '';
}

export default function TriagePoCapture({ session, openerRef, batchId = '', onCounted }) {
  const isMobile = useIsMobile();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const { triage } = useTransferWorkflow();
  const liveCamera = !prefersDeviceCamera() && webcamSupported();
  const [open, setOpen] = useState(false);
  const [poInput, setPoInput] = useState('');
  const [photoUri, setPhotoUri] = useState('');
  const [phase, setPhase] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [matches, setMatches] = useState([]);
  const [po, setPo] = useState(null);
  const [resultOpen, setResultOpen] = useState(false);
  const [errorMode, setErrorMode] = useState(false);
  const [errorNote, setErrorNote] = useState('');
  const [errorType, setErrorType] = useState('');
  const [resultError, setResultError] = useState('');
  const [finishing, setFinishing] = useState(false);
  const [notice, setNotice] = useState('');
  const [needsSettings, setNeedsSettings] = useState(false);
  const [buyCatalog, setBuyCatalog] = useState(null);
  const [previewBox, setPreviewBox] = useState({ width: 0, height: 0 });
  const requestRef = useRef(0);
  const openRef = useRef(false);
  openRef.current = open;
  const onSnapCamera = !isMobile || (!resultOpen && matches.length <= 1);
  const { videoRef, cameraState, startCamera, stopStream, setVideoNode } = useWebcam({
    active: open && liveCamera && !photoUri && onSnapCamera,
    autoStart: false,
    constraints: CAMERA_CONSTRAINTS,
  });

  useEffect(() => {
    if (!isMobile || !open || !liveCamera || photoUri || !onSnapCamera) return undefined;
    void startCamera();
    return undefined;
  }, [isMobile, liveCamera, onSnapCamera, open, photoUri, startCamera]);

  useEffect(() => {
    if (!open && !resultOpen) return undefined;
    let cancelled = false;
    fetchWebsitePrices()
      .then((next) => {
        if (!cancelled) setBuyCatalog(next);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open, resultOpen]);

  useEffect(() => {
    if (open) return undefined;
    requestRef.current += 1;
    stopStream();
    setPoInput('');
    setPhotoUri('');
    setPhase('');
    setError('');
    setBusy(false);
    setMatches([]);
    setPo(null);
    setResultOpen(false);
    setErrorMode(false);
    setErrorNote('');
    setErrorType('');
    setResultError('');
    setFinishing(false);
    setNotice('');
    setNeedsSettings(false);
    return undefined;
  }, [open, stopStream]);

  const loadPo = async (raw, token) => {
    const id = normalizePoNumber(raw);
    if (!id) {
      setPhase('');
      setError('Enter a PO number.');
      return;
    }
    setPhase(`Looking up PO# ${id}…`);
    setError('');
    setNotice('');
    setMatches([]);
    setPo(null);
    setResultOpen(false);
    const rows = await lookupPurchasesByPoNumber(session, id);
    if (token !== requestRef.current) return;
    setPhase('');
    if (!rows.length) {
      setError(`No purchase found for PO# ${id}.`);
      return;
    }
    setMatches(rows);
    setPo(rows[0]);
    if (rows.length === 1) openResult(rows[0]);
  };

  const openResult = (row) => {
    setPo(row);
    setErrorMode(false);
    setErrorNote('');
    setErrorType('');
    setResultError('');
    setResultOpen(true);
  };

  const analyzePhoto = async (asset) => {
    const token = ++requestRef.current;
    setBusy(true);
    setError('');
    setMatches([]);
    setPo(null);
    setResultOpen(false);
    setNotice('');
    setPhase('Reading the PO number…');
    try {
      const raw = await assetToDataUrl(asset);
      if (token !== requestRef.current) return;
      setPhotoUri(raw);
      const poNumber = await readPoNumberFromPhoto(raw);
      if (token !== requestRef.current) return;
      if (!poNumber) {
        setPhase('');
        setError('Could not read a PO number from that photo. Type it in the box.');
        return;
      }
      setPoInput(poNumber);
      await loadPo(poNumber, token);
    } catch (err) {
      if (token !== requestRef.current) return;
      setPhase('');
      setError(err?.message || 'Could not read that photo.');
    } finally {
      if (token === requestRef.current) setBusy(false);
    }
  };

  const launchDeviceCamera = async () => {
    setError('');
    try {
      if (Platform.OS !== 'web') {
        const current = await ImagePicker.getCameraPermissionsAsync();
        const permission = current.granted ? current : await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) {
          const blocked = permission.canAskAgain === false;
          setNeedsSettings(blocked);
          setError(
            blocked
              ? 'Camera is off. Enable it in Settings, then come back and tap Enable camera.'
              : 'Allow camera access to photograph the PO.',
          );
          if (blocked && needsSettings) await Linking.openSettings();
          return;
        }
        setNeedsSettings(false);
      }
      const result = await ImagePicker.launchCameraAsync(PICKER_OPTIONS);
      if (!openRef.current || result.canceled || !result.assets?.[0]) return;
      await analyzePhoto(result.assets[0]);
    } catch (err) {
      if (!openRef.current) return;
      setError(err?.message || 'Could not open the camera.');
    }
  };

  const close = () => {
    openRef.current = false;
    setOpen(false);
  };

  const openCapture = () => {
    openRef.current = true;
    setOpen(true);
    if (isMobile) return;
    if (liveCamera) void startCamera();
    else void launchDeviceCamera();
  };

  const enableCamera = () => {
    if (liveCamera && cameraState !== 'unsupported') {
      void startCamera();
      return;
    }
    void launchDeviceCamera();
  };

  const snap = () => {
    if (cameraState !== 'live' || busy) return;
    const dataUrl = captureFrame(getVideoElement(videoRef.current), { cropPaper: !isMobile });
    if (!dataUrl) {
      setError('Could not capture a frame. Try again.');
      return;
    }
    void analyzePhoto(dataUrl);
  };

  const onShutter = () => {
    if (busy) return;
    if (liveCamera) snap();
    else void launchDeviceCamera();
  };

  const retake = () => {
    requestRef.current += 1;
    setPhotoUri('');
    setPhase('');
    setError('');
    setBusy(false);
    setMatches([]);
    setPo(null);
    setResultOpen(false);
    if (isMobile) return;
    if (liveCamera) void startCamera();
    else void launchDeviceCamera();
  };

  const nextPo = () => {
    requestRef.current += 1;
    setPoInput('');
    setPhotoUri('');
    setPhase('');
    setError('');
    setBusy(false);
    setMatches([]);
    setPo(null);
    setResultOpen(false);
    setErrorMode(false);
    setErrorNote('');
    setErrorType('');
    setResultError('');
    if (isMobile) return;
    if (liveCamera) void startCamera();
    else void launchDeviceCamera();
  };

  const leaveMobilePage = () => {
    if (errorMode) {
      setErrorMode(false);
      setResultError('');
      return;
    }
    if (resultOpen) {
      setResultOpen(false);
      return;
    }
    if (matches.length > 1) {
      setMatches([]);
      return;
    }
    close();
  };

  const finishPo = async (withError) => {
    if (!po || finishing) return;
    const note = errorNote.trim();
    if (withError && !note && !errorType) {
      setResultError('Add a note or pick an error type.');
      return;
    }
    const actor = actorNameOf(session);
    const place = ensurePurchaseOnDateBatch(po, actor);
    const day = poDateKey(po);
    setFinishing(true);
    setResultError('');
    try {
      if (withError) {
        saveTriagePoReview(
          place?.item?.id || po.id,
          { note, errorType, errorAmount: '' },
          triageEditorFromSession(session),
        );
      }
      if (!place?.batch || !place.store || !day) {
        setResultError('This purchase has no store or date to count.');
        return;
      }
      if (place.item) setTriagePoReceived(place.batch.id, place.item.id, true, actor);
      const grid = buildDailyReceiptGrid(place.batch);
      const storeKey = batchStoreKey(place.store);
      const counted = await countDailyReceiptPo(
        place.batch.id,
        {
          dayKey: day,
          storeKey,
          storeName: place.store.name,
          expected: grid.expected[dailyCellKey(day, storeKey)] || 0,
          poId: place.item?.id || po.id,
        },
        actorNameOf(session),
      );
      onCounted?.(place.batch.id);
      const where = [place.store.name, po.dateLabel].filter(Boolean).join(' · ');
      setNotice(
        counted.counted
          ? `Counted for ${where}. ${counted.received} received.`
          : `Already counted for ${where}.`,
      );
      nextPo();
    } catch (err) {
      setResultError(err?.message || 'Could not update the count.');
    } finally {
      setFinishing(false);
    }
  };

  const lookupTyped = async () => {
    if (busy) return;
    const token = ++requestRef.current;
    setBusy(true);
    try {
      await loadPo(poInput, token);
    } catch (err) {
      if (token !== requestRef.current) return;
      setPhase('');
      setError(err?.message || 'Could not look up that PO.');
    } finally {
      if (token === requestRef.current) setBusy(false);
    }
  };

  const onPreviewLayout = (event) => {
    const { width, height } = event.nativeEvent.layout;
    setPreviewBox((current) =>
      current.width === width && current.height === height ? current : { width, height },
    );
  };
  const measured = previewBox.height > 80 && previewBox.width > 80;
  const boxWidth = measured ? Math.max(0, previewBox.width - 40) : Math.min(windowWidth - 64, 420);
  const boxHeight = measured
    ? Math.max(0, previewBox.height - 24)
    : Math.max(320, windowHeight * (isMobile ? 0.58 : 0.52));
  const paperWidth = Math.min(boxWidth, boxHeight * PAPER_ASPECT);
  const paperHeight = paperWidth > 0 ? paperWidth / PAPER_ASPECT : 0;

  const lines = Array.isArray(po?.pricedLines) ? po.pricedLines : [];
  const place = po ? placePurchaseOnBatch(triage, po, batchId) : null;
  const placeLabel = place ? [place.store?.name, po?.dateLabel].filter(Boolean).join(' · ') : '';
  if (openerRef) openerRef.current = openCapture;

  const pagePad = Platform.OS === 'web' ? { className: 'cgold-mobile-sheet-top' } : null;
  const dockPad = 16 + mobileSafeBottom();
  const mobileFlow = (
    <View style={styles.mobileRoot}>
      {resultOpen && po && errorMode ? (
        <KeyboardAvoidingView
          style={styles.page}
          behavior={Platform.OS === 'android' ? undefined : 'padding'}
        >
          <View style={[styles.pageNav, Platform.OS !== 'web' && styles.pageNavNative]} {...pagePad}>
            <Pressable
              style={styles.pageBack}
              onPress={() => {
                setErrorMode(false);
                setResultError('');
              }}
              accessibilityRole="button"
              accessibilityLabel="Back to PO details"
            >
              <Ionicons name="chevron-back" size={26} color="#007AFF" />
              <Text style={styles.pageBackText}>Details</Text>
            </Pressable>
            <Text style={styles.pageTitle}>Error</Text>
          </View>
          <ScrollView
            style={styles.pageBody}
            contentContainerStyle={styles.pageScroll}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.group}>
              {ERROR_TYPES.map((label, index) => {
                const selected = errorType === label;
                return (
                  <Pressable
                    key={label}
                    style={[styles.groupRow, index === ERROR_TYPES.length - 1 && styles.groupRowLast]}
                    onPress={() => setErrorType(selected ? '' : label)}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                  >
                    <Text style={styles.groupLabel}>{label}</Text>
                    {selected ? <Ionicons name="checkmark" size={20} color="#007AFF" /> : null}
                  </Pressable>
                );
              })}
            </View>
            <TextInput
              style={styles.appleNote}
              value={errorNote}
              onChangeText={setErrorNote}
              placeholder="What does not match the paper?"
              placeholderTextColor="#8E8E93"
              multiline
              editable={!finishing}
              accessibilityLabel="Error note"
            />
            {resultError ? <Text style={styles.error}>{resultError}</Text> : null}
          </ScrollView>
          <View style={[styles.pageFooter, { paddingBottom: dockPad }]}>
            <Pressable
              style={[styles.pagePrimary, finishing && styles.lookupOff]}
              onPress={() => void finishPo(true)}
              disabled={finishing}
              accessibilityRole="button"
              accessibilityLabel="Save error"
            >
              <Text style={styles.pagePrimaryText}>{finishing ? 'Saving…' : 'Save error'}</Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      ) : resultOpen && po ? (
        <View style={styles.page}>
          <View style={[styles.pageNav, Platform.OS !== 'web' && styles.pageNavNative]} {...pagePad}>
            <Pressable
              style={styles.pageBack}
              onPress={() => setResultOpen(false)}
              accessibilityRole="button"
              accessibilityLabel="Back to camera"
            >
              <Ionicons name="chevron-back" size={26} color="#007AFF" />
              <Text style={styles.pageBackText}>Camera</Text>
            </Pressable>
            <Text style={styles.pageTitle} numberOfLines={1}>{po.reference || 'PO'}</Text>
          </View>
          <ScrollView style={styles.pageBody} contentContainerStyle={styles.pageScroll}>
            <Text style={styles.resultKicker}>Total</Text>
            <Text style={styles.pageTotal}>{moneyLabel(po.amount)}</Text>
            <Text style={styles.detailMeta}>
              {[po.dateLabel, po.storeName, po.customerName].filter(Boolean).join(' · ')}
            </Text>
            {lines.length ? (
              <View style={styles.group}>
                {lines.map((line, index) => {
                  const weight = weightLabel(line);
                  return (
                    <View
                      key={`${line.name}-${index}`}
                      style={[styles.groupRow, index === lines.length - 1 && styles.groupRowLast]}
                    >
                      <View style={styles.lineCopy}>
                        <Text style={styles.lineName} numberOfLines={2}>
                          {lineTitle(line, buyCatalog)}
                        </Text>
                        {weight ? <Text style={styles.lineWeight}>{weight}</Text> : null}
                      </View>
                      <Text style={styles.lineMoney}>{moneyLabel(line.lineTotal)}</Text>
                    </View>
                  );
                })}
              </View>
            ) : (
              <Text style={styles.detailMeta}>No line items on this purchase.</Text>
            )}
            <Text style={styles.placeLine}>
              {placeLabel
                ? `Counts toward ${placeLabel}`
                : po?.dateLabel
                  ? `Starts the ${po.dateLabel} batch for this store.`
                  : 'This purchase has no date to file.'}
            </Text>
            {resultError ? <Text style={styles.error}>{resultError}</Text> : null}
          </ScrollView>
          <View style={[styles.pageFooter, { paddingBottom: dockPad }]}>
            <Pressable
              style={styles.pageSecondary}
              onPress={() => {
                setErrorMode(true);
                setResultError('');
              }}
              disabled={finishing}
              accessibilityRole="button"
              accessibilityLabel="Add error"
            >
              <Text style={styles.pageSecondaryText}>Add error</Text>
            </Pressable>
            <Pressable
              style={[styles.pagePrimary, finishing && styles.lookupOff]}
              onPress={() => void finishPo(false)}
              disabled={finishing}
              accessibilityRole="button"
              accessibilityLabel="Finish"
            >
              <Text style={styles.pagePrimaryText}>{finishing ? 'Saving…' : 'Finish'}</Text>
            </Pressable>
          </View>
        </View>
      ) : matches.length > 1 ? (
        <View style={styles.page}>
          <View style={[styles.pageNav, Platform.OS !== 'web' && styles.pageNavNative]} {...pagePad}>
            <Pressable
              style={styles.pageBack}
              onPress={() => setMatches([])}
              accessibilityRole="button"
              accessibilityLabel="Back to camera"
            >
              <Ionicons name="chevron-back" size={26} color="#007AFF" />
              <Text style={styles.pageBackText}>Camera</Text>
            </Pressable>
            <Text style={styles.pageTitle}>Choose PO</Text>
          </View>
          <ScrollView style={styles.pageBody} contentContainerStyle={styles.pageScroll}>
            <Text style={styles.detailMeta}>More than one purchase uses this number.</Text>
            <View style={styles.group}>
              {matches.map((row, index) => (
                <Pressable
                  key={row.id}
                  style={[styles.groupRow, index === matches.length - 1 && styles.groupRowLast]}
                  onPress={() => openResult(row)}
                  accessibilityRole="button"
                >
                  <View style={styles.lineCopy}>
                    <Text style={styles.groupLabel}>{row.reference}</Text>
                    <Text style={styles.lineWeight} numberOfLines={1}>
                      {[row.storeName, row.systemLabel].filter(Boolean).join(' · ')}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color="#C7C7CC" />
                </Pressable>
              ))}
            </View>
          </ScrollView>
        </View>
      ) : (
        <View style={styles.snap}>
          <View style={styles.snapStage}>
            {photoUri ? (
              <Image source={{ uri: photoUri }} style={styles.snapMedia} resizeMode="cover" />
            ) : liveCamera && Platform.OS === 'web' ? (
              createElement('video', {
                ref: setVideoNode,
                autoPlay: true,
                muted: true,
                playsInline: true,
                style: {
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  backgroundColor: '#000',
                  outline: 'none',
                  border: 'none',
                },
              })
            ) : null}
          </View>
          <KeyboardAvoidingView
            style={styles.snapOverlay}
            behavior={Platform.OS === 'android' ? undefined : 'padding'}
            pointerEvents="box-none"
          >
            <View
              style={[styles.snapTop, Platform.OS !== 'web' && styles.pageNavNative]}
              {...pagePad}
              pointerEvents="box-none"
            >
              <Pressable onPress={close} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
                <Ionicons name="close" size={34} color="#fff" />
              </Pressable>
              {photoUri ? (
                <Pressable onPress={retake} disabled={busy} accessibilityRole="button" accessibilityLabel="Retake photo">
                  <Text style={styles.snapRetake}>Retake</Text>
                </Pressable>
              ) : (
                <View style={styles.snapRetakeSpacer} />
              )}
            </View>
            <View style={styles.snapMid} pointerEvents="box-none">
              {!photoUri && liveCamera && cameraState !== 'live' ? (
                <View style={styles.snapCenter}>
                  <Text style={styles.snapCenterText}>
                    {cameraState === 'requesting'
                      ? 'Starting camera…'
                      : cameraState === 'denied'
                        ? 'Camera is off. You can turn it back on.'
                        : 'Camera is off.'}
                  </Text>
                  {cameraState === 'requesting' ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Pressable style={styles.enableButton} onPress={enableCamera} accessibilityRole="button">
                      <Text style={styles.enableButtonText}>Enable camera</Text>
                    </Pressable>
                  )}
                </View>
              ) : null}
            </View>
            <View style={[styles.snapDock, { paddingBottom: dockPad }]}>
              {phase ? <Text style={styles.snapPhase}>{phase}</Text> : null}
              {error ? <Text style={styles.snapError}>{error}</Text> : null}
              {notice ? <Text style={styles.snapNotice}>{notice}</Text> : null}
              <View style={styles.appleField}>
                <Ionicons name="search" size={18} color="#8E8E93" />
                <TextInput
                  style={styles.appleInput}
                  value={poInput}
                  onChangeText={setPoInput}
                  placeholder="PO #"
                  placeholderTextColor="#8E8E93"
                  keyboardType="number-pad"
                  returnKeyType="search"
                  underlineColorAndroid="transparent"
                  editable={!busy}
                  onSubmitEditing={() => void lookupTyped()}
                  accessibilityLabel="PO number"
                />
                {poInput.trim() ? (
                  <Pressable
                    onPress={() => void lookupTyped()}
                    disabled={busy}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel="Look up PO"
                  >
                    {busy ? (
                      <ActivityIndicator color="#007AFF" />
                    ) : (
                      <Text style={styles.appleGo}>Look up</Text>
                    )}
                  </Pressable>
                ) : null}
              </View>
              {photoUri ? null : (
                <Pressable
                  style={[styles.snapShutter, (busy || (liveCamera && cameraState !== 'live')) && styles.shutterOff]}
                  onPress={onShutter}
                  disabled={busy || (liveCamera && cameraState !== 'live')}
                  accessibilityRole="button"
                  accessibilityLabel="Take photo"
                >
                  <View style={styles.snapShutterRing}>
                    <View style={styles.snapShutterCore} />
                  </View>
                </Pressable>
              )}
            </View>
          </KeyboardAvoidingView>
        </View>
      )}
    </View>
  );

  return (
    <>
    <Modal
      visible={open}
      transparent={!isMobile}
      animationType={isMobile ? 'slide' : 'fade'}
      presentationStyle={isMobile ? 'fullScreen' : undefined}
      onRequestClose={isMobile ? leaveMobilePage : close}
    >
      {isMobile ? (
        mobileFlow
      ) : (
        <KeyboardAvoidingView
          style={styles.backdrop}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <Pressable style={StyleSheet.absoluteFill} onPress={close} />
          <View style={[styles.sheet, isMobile && styles.sheetMobile]} accessibilityViewIsModal>
            <View style={styles.header}>
              <Text style={styles.title}>Scan PO</Text>
              <Pressable onPress={close} hitSlop={8} accessibilityLabel="Close">
                <Text style={styles.close}>Close</Text>
              </Pressable>
            </View>

            <View style={styles.previewWell} onLayout={onPreviewLayout}>
              <View style={[styles.previewShell, paperWidth > 0 && { width: paperWidth, height: paperHeight }]}>
              {photoUri ? (
                <Image source={{ uri: photoUri }} style={styles.preview} resizeMode="cover" />
              ) : liveCamera && Platform.OS === 'web' ? (
                createElement('video', {
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
              ) : (
                <Pressable style={styles.previewEmpty} onPress={enableCamera} disabled={busy}>
                  <Ionicons name="camera" size={28} color="#fff" />
                  <Text style={styles.previewEmptyText}>{needsSettings ? 'Enable camera' : 'Open camera'}</Text>
                </Pressable>
              )}
              {liveCamera && !photoUri && cameraState !== 'live' ? (
                <View style={styles.overlay}>
                  <Text style={styles.overlayText}>
                    {cameraState === 'requesting'
                      ? 'Starting camera…'
                      : cameraState === 'denied'
                        ? 'Camera is off. You can turn it back on.'
                        : cameraState === 'unsupported'
                          ? 'This browser cannot use the camera.'
                          : 'Camera is off.'}
                  </Text>
                  {cameraState !== 'requesting' ? (
                    <Pressable
                      style={styles.enableButton}
                      onPress={enableCamera}
                      disabled={busy}
                      accessibilityRole="button"
                      accessibilityLabel="Enable camera"
                    >
                      <Text style={styles.enableButtonText}>Enable camera</Text>
                    </Pressable>
                  ) : null}
                </View>
              ) : null}
              {photoUri ? (
                <Pressable style={styles.retake} onPress={retake} disabled={busy} accessibilityLabel="Retake photo">
                  <Text style={styles.retakeText}>Retake</Text>
                </Pressable>
              ) : liveCamera && cameraState === 'live' ? (
                <View style={styles.shutterBar} pointerEvents="box-none">
                  <Pressable
                    style={[styles.shutter, (busy || cameraState !== 'live') && styles.shutterOff]}
                    onPress={snap}
                    disabled={busy || cameraState !== 'live'}
                    accessibilityLabel="Take photo"
                  >
                    <View style={styles.shutterCore} />
                  </Pressable>
                </View>
              ) : null}
              </View>
            </View>

            <View style={styles.poBlock}>
              {phase ? (
                <View style={styles.phaseRow}>
                  <ActivityIndicator color={T.green} />
                  <Text style={styles.phase}>{phase}</Text>
                </View>
              ) : null}
              {error ? <Text style={styles.error}>{error}</Text> : null}

              <Text style={styles.fieldLabel}>PO number</Text>
              <View style={styles.fieldRow}>
                <TextInput
                  style={styles.field}
                  value={poInput}
                  onChangeText={setPoInput}
                  placeholder="Type the PO"
                  placeholderTextColor={T.secondary}
                  keyboardType="number-pad"
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!busy}
                  onSubmitEditing={() => void lookupTyped()}
                  accessibilityLabel="PO number"
                />
                <Pressable
                  style={[styles.lookup, busy && styles.lookupOff]}
                  onPress={() => void lookupTyped()}
                  disabled={busy}
                  accessibilityRole="button"
                  accessibilityLabel="Look up PO"
                >
                  <Text style={styles.lookupText}>Look up</Text>
                </Pressable>
              </View>
            </View>

            <ScrollView
              style={styles.scroll}
              contentContainerStyle={styles.scrollContent}
              keyboardShouldPersistTaps="handled"
            >
              {matches.length > 1 ? (
                <View style={styles.matchList}>
                  {matches.map((row) => {
                    const selected = po?.id === row.id;
                    return (
                      <Pressable
                        key={row.id}
                        style={[styles.matchRow, selected && styles.matchRowOn]}
                        onPress={() => openResult(row)}
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                      >
                        <Text style={styles.matchTitle}>{row.reference}</Text>
                        <Text style={styles.matchMeta} numberOfLines={1}>
                          {[row.storeName, row.systemLabel].filter(Boolean).join(' · ')}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              ) : null}

              {notice ? <Text style={styles.notice}>{notice}</Text> : null}
              {po && !resultOpen ? (
                <Pressable style={styles.review} onPress={() => openResult(po)} accessibilityRole="button">
                  <Text style={styles.reviewText}>Review {po.reference}</Text>
                </Pressable>
              ) : null}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      )}
    </Modal>

    <Modal
      visible={open && resultOpen && Boolean(po) && !isMobile}
      transparent
      animationType={isMobile ? 'slide' : 'fade'}
      onRequestClose={() => setResultOpen(false)}
    >
      <KeyboardAvoidingView
        style={[styles.backdrop, isMobile && styles.backdropSheet]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={() => setResultOpen(false)} />
        <View style={[styles.resultSheet, isMobile && styles.resultSheetMobile]} accessibilityViewIsModal>
          {isMobile ? <View style={styles.grabber} /> : null}
          <View style={styles.header}>
            <Text style={styles.title} numberOfLines={1}>{po?.reference || 'PO'}</Text>
            <Pressable onPress={() => setResultOpen(false)} hitSlop={8} accessibilityLabel="Close">
              <Text style={styles.resultClose}>Close</Text>
            </Pressable>
          </View>
          <View style={styles.resultContent}>
            <Text style={styles.resultKicker}>Total</Text>
            <Text style={styles.resultTotal}>{moneyLabel(po?.amount)}</Text>
            <Text style={styles.detailMeta}>
              {[po?.dateLabel, po?.storeName, po?.customerName].filter(Boolean).join(' · ')}
            </Text>
            {lines.length ? (
              <View style={styles.resultLines}>
                {lines.map((line, index) => {
                  const weight = weightLabel(line);
                  return (
                    <View
                      key={`${line.name}-${index}`}
                      style={[styles.line, index === lines.length - 1 && styles.lineLast]}
                    >
                      <View style={styles.lineCopy}>
                        <Text style={styles.lineName} numberOfLines={2}>
                          {lineTitle(line, buyCatalog)}
                        </Text>
                        {weight ? <Text style={styles.lineWeight}>{weight}</Text> : null}
                      </View>
                      <Text style={styles.lineMoney}>{moneyLabel(line.lineTotal)}</Text>
                    </View>
                  );
                })}
              </View>
            ) : (
              <Text style={styles.detailMeta}>No line items on this purchase.</Text>
            )}

            <Text style={styles.placeLine}>
              {placeLabel
                ? `Counts toward ${placeLabel}`
                : po?.dateLabel
                  ? `Starts the ${po.dateLabel} batch for this store.`
                  : 'This purchase has no date to file.'}
            </Text>

            {errorMode ? (
              <View style={styles.errorBox}>
                <Text style={styles.fieldLabel}>Error</Text>
                <View style={styles.typeWrap}>
                  {ERROR_TYPES.map((label) => {
                    const selected = errorType === label;
                    return (
                      <Pressable
                        key={label}
                        style={[styles.typeChip, selected && styles.typeChipOn]}
                        onPress={() => setErrorType(selected ? '' : label)}
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                      >
                        <Text style={[styles.typeChipText, selected && styles.typeChipTextOn]}>{label}</Text>
                      </Pressable>
                    );
                  })}
                </View>
                <TextInput
                  style={styles.note}
                  value={errorNote}
                  onChangeText={setErrorNote}
                  placeholder="What does not match the paper?"
                  placeholderTextColor={T.secondary}
                  multiline
                  editable={!finishing}
                  accessibilityLabel="Error note"
                />
              </View>
            ) : null}
            {resultError ? <Text style={styles.error}>{resultError}</Text> : null}
          </View>
          <View style={[styles.resultActions, isMobile && styles.resultActionsMobile]}>
            {errorMode ? (
              <>
                <Pressable
                  style={styles.secondary}
                  onPress={() => {
                    setErrorMode(false);
                    setResultError('');
                  }}
                  disabled={finishing}
                  accessibilityRole="button"
                >
                  <Text style={styles.secondaryText}>Back</Text>
                </Pressable>
                <Pressable
                  style={[styles.next, finishing && styles.lookupOff]}
                  onPress={() => void finishPo(true)}
                  disabled={finishing}
                  accessibilityRole="button"
                  accessibilityLabel="Save error"
                >
                  <Text style={styles.nextText}>{finishing ? 'Saving…' : 'Save error'}</Text>
                </Pressable>
              </>
            ) : (
              <>
                <Pressable
                  style={styles.secondary}
                  onPress={() => {
                    setErrorMode(true);
                    setResultError('');
                  }}
                  disabled={finishing}
                  accessibilityRole="button"
                  accessibilityLabel="Add error"
                >
                  <Text style={styles.secondaryText}>Add error</Text>
                </Pressable>
                <Pressable
                  style={[styles.next, finishing && styles.lookupOff]}
                  onPress={() => void finishPo(false)}
                  disabled={finishing}
                  accessibilityRole="button"
                  accessibilityLabel="Finish"
                >
                  <Text style={styles.nextText}>{finishing ? 'Saving…' : 'Finish'}</Text>
                </Pressable>
              </>
            )}
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  backdropSheet: {
    justifyContent: 'flex-end',
    padding: 0,
  },
  sheet: {
    width: '100%',
    maxWidth: 520,
    height: '92%',
    maxHeight: '92%',
    borderRadius: 16,
    backgroundColor: T.bg,
    overflow: 'hidden',
    flexDirection: 'column',
  },
  resultSheet: {
    width: '100%',
    maxWidth: 440,
    borderRadius: 12,
    backgroundColor: '#fff',
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e5ea',
    ...Platform.select({
      web: { boxShadow: '0 12px 32px rgba(0,0,0,0.10)' },
      default: { elevation: 8 },
    }),
  },
  resultSheetMobile: {
    maxWidth: '100%',
    borderRadius: 0,
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    borderBottomWidth: 0,
  },
  grabber: {
    alignSelf: 'center',
    width: 36,
    height: 5,
    marginTop: 8,
    borderRadius: 3,
    backgroundColor: '#d1d1d6',
  },
  sheetMobile: {
    maxWidth: '100%',
    height: '100%',
    maxHeight: '100%',
    flex: 1,
    alignSelf: 'stretch',
    borderRadius: 0,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 52,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: T.hairline,
  },
  title: {
    flex: 1,
    minWidth: 0,
    fontFamily: FONT,
    fontSize: 17,
    fontWeight: '700',
    color: T.text,
    letterSpacing: -0.3,
  },
  close: {
    fontFamily: FONT,
    fontSize: 16,
    fontWeight: '600',
    color: T.blue,
  },
  scroll: {
    flexGrow: 0,
    maxHeight: 132,
    minHeight: 0,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 16,
    gap: 12,
  },
  previewWell: {
    flex: 1,
    minHeight: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  previewShell: {
    maxWidth: '100%',
    maxHeight: '100%',
    borderRadius: 4,
    overflow: 'hidden',
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: '#d2d2d7',
  },
  poBlock: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
    gap: 8,
  },
  preview: {
    width: '100%',
    height: '100%',
  },
  previewEmpty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#1F8A4E',
  },
  previewEmptyText: {
    fontFamily: FONT,
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 2,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    paddingHorizontal: 24,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  overlayText: {
    fontFamily: FONT,
    fontSize: 15,
    fontWeight: '600',
    lineHeight: 20,
    color: '#fff',
    textAlign: 'center',
  },
  enableButton: {
    minHeight: 44,
    paddingHorizontal: 18,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  enableButtonText: {
    fontFamily: FONT,
    fontSize: 16,
    fontWeight: '700',
    color: '#111',
  },
  shutterBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 14,
    alignItems: 'center',
  },
  shutter: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 3,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterOff: {
    opacity: 0.45,
  },
  shutterCore: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#fff',
  },
  retake: {
    position: 'absolute',
    right: 12,
    bottom: 12,
    minHeight: 34,
    paddingHorizontal: 12,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  retakeText: {
    fontFamily: FONT,
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
  phaseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  phase: {
    fontFamily: FONT,
    fontSize: 14,
    color: T.text,
  },
  error: {
    fontFamily: FONT,
    fontSize: 14,
    lineHeight: 19,
    color: T.red,
  },
  notice: {
    fontFamily: FONT,
    fontSize: 14,
    lineHeight: 19,
    color: '#248A3D',
  },
  review: {
    minHeight: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: T.green,
  },
  reviewText: {
    fontFamily: FONT,
    fontSize: 15,
    fontWeight: '700',
    color: '#fff',
  },
  fieldLabel: {
    fontFamily: FONT,
    fontSize: 12,
    fontWeight: '600',
    color: T.secondary,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  field: {
    flex: 1,
    minHeight: 46,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: T.hairline,
    backgroundColor: '#fff',
    fontFamily: FONT,
    fontSize: 17,
    color: T.text,
  },
  lookup: {
    minHeight: 46,
    paddingHorizontal: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: T.green,
  },
  lookupOff: {
    opacity: 0.5,
  },
  lookupText: {
    fontFamily: FONT,
    fontSize: 15,
    fontWeight: '700',
    color: '#fff',
  },
  next: {
    flex: 1,
    minHeight: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1F8A4E',
  },
  secondary: {
    flex: 1,
    minHeight: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: T.hairline,
    backgroundColor: '#fff',
  },
  secondaryText: {
    fontFamily: FONT,
    fontSize: 16,
    fontWeight: '600',
    color: T.text,
  },
  resultContent: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 4,
    gap: 4,
  },
  placeLine: {
    fontFamily: FONT,
    fontSize: 13,
    lineHeight: 18,
    color: T.secondary,
    marginTop: 8,
  },
  errorBox: {
    gap: 8,
    marginTop: 8,
  },
  typeWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  typeChip: {
    minHeight: 32,
    paddingHorizontal: 10,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: T.hairline,
    backgroundColor: '#fff',
  },
  typeChipOn: {
    backgroundColor: 'rgba(255,59,48,0.12)',
    borderColor: T.red,
  },
  typeChipText: {
    fontFamily: FONT,
    fontSize: 13,
    color: T.text,
  },
  typeChipTextOn: {
    color: T.red,
    fontWeight: '600',
  },
  note: {
    minHeight: 64,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: T.hairline,
    backgroundColor: '#fff',
    fontFamily: FONT,
    fontSize: 16,
    color: T.text,
    textAlignVertical: 'top',
  },
  resultActions: {
    flexDirection: 'row',
    gap: 8,
    padding: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#ececef',
  },
  resultActionsMobile: {
    paddingBottom: Math.max(20, mobileSafeBottom()),
  },
  nextText: {
    fontFamily: FONT,
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
  },
  matchList: {
    gap: 8,
  },
  matchRow: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: T.hairline,
  },
  matchRowOn: {
    borderColor: T.green,
    backgroundColor: 'rgba(52,199,89,0.1)',
  },
  matchTitle: {
    fontFamily: FONT,
    fontSize: 15,
    fontWeight: '600',
    color: T.text,
  },
  matchMeta: {
    fontFamily: FONT,
    fontSize: 13,
    color: T.secondary,
  },
  detail: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: T.hairline,
    padding: 14,
    gap: 4,
  },
  detailKicker: {
    fontFamily: FONT,
    fontSize: 12,
    fontWeight: '600',
    color: '#248A3D',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  detailTitle: {
    fontFamily: FONT,
    fontSize: 20,
    fontWeight: '700',
    color: T.text,
    letterSpacing: -0.4,
  },
  resultClose: {
    fontFamily: FONT,
    fontSize: 16,
    fontWeight: '600',
    color: '#1F8A4E',
  },
  resultKicker: {
    fontFamily: FONT,
    fontSize: 13,
    fontWeight: '500',
    color: '#6e6e73',
  },
  resultTotal: {
    fontFamily: FONT,
    fontSize: 26,
    fontWeight: '600',
    color: '#1d1d1f',
    letterSpacing: -0.6,
    fontVariant: ['tabular-nums'],
  },
  resultLines: {
    marginTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#ececef',
  },
  detailMeta: {
    fontFamily: FONT,
    fontSize: 13,
    lineHeight: 18,
    color: '#8e8e93',
  },
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 44,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ececef',
  },
  lineLast: {
    borderBottomWidth: 0,
    paddingBottom: 0,
  },
  lineCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  lineName: {
    fontFamily: FONT,
    fontSize: 15,
    fontWeight: '500',
    color: '#1d1d1f',
    letterSpacing: -0.2,
  },
  lineWeight: {
    fontFamily: FONT,
    fontSize: 13,
    color: '#8e8e93',
  },
  lineMoney: {
    flexShrink: 0,
    fontFamily: FONT,
    fontSize: 15,
    fontWeight: '500',
    color: '#1d1d1f',
    fontVariant: ['tabular-nums'],
  },
  mobileRoot: {
    flex: 1,
    backgroundColor: '#000',
    ...Platform.select({
      web: { height: '100vh' },
      default: {},
    }),
  },
  snap: {
    flex: 1,
    backgroundColor: '#000',
  },
  snapStage: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000',
  },
  snapMedia: {
    width: '100%',
    height: '100%',
  },
  snapOverlay: {
    flex: 1,
  },
  snapTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    minHeight: 52,
  },
  snapRetake: {
    fontFamily: FONT,
    fontSize: 17,
    fontWeight: '600',
    color: '#fff',
  },
  snapRetakeSpacer: {
    width: 34,
  },
  snapMid: {
    flex: 1,
  },
  snapCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    paddingHorizontal: 32,
  },
  snapCenterText: {
    fontFamily: FONT,
    fontSize: 17,
    fontWeight: '600',
    color: '#fff',
    textAlign: 'center',
  },
  snapDock: {
    alignItems: 'center',
    gap: 18,
    paddingHorizontal: 16,
  },
  snapPhase: {
    fontFamily: FONT,
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
    textAlign: 'center',
  },
  snapError: {
    fontFamily: FONT,
    fontSize: 15,
    fontWeight: '600',
    color: '#FF453A',
    textAlign: 'center',
  },
  snapNotice: {
    fontFamily: FONT,
    fontSize: 15,
    fontWeight: '600',
    color: '#30D158',
    textAlign: 'center',
  },
  appleField: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 44,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: '#fff',
  },
  appleInput: {
    flex: 1,
    minWidth: 0,
    minHeight: 44,
    paddingVertical: 0,
    fontFamily: FONT,
    fontSize: 17,
    color: '#000',
    ...Platform.select({
      web: { outlineStyle: 'none' },
      default: {},
    }),
  },
  appleGo: {
    fontFamily: FONT,
    fontSize: 17,
    fontWeight: '600',
    color: '#007AFF',
  },
  snapShutter: {
    width: 84,
    height: 84,
    alignItems: 'center',
    justifyContent: 'center',
  },
  snapShutterRing: {
    width: 78,
    height: 78,
    borderRadius: 39,
    borderWidth: 4,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  snapShutterCore: {
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: '#fff',
  },
  page: {
    flex: 1,
    backgroundColor: '#F2F2F7',
  },
  pageNav: {
    position: 'relative',
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F2F2F7',
  },
  pageNavNative: {
    paddingTop: mobileSafeTop(),
  },
  pageBack: {
    position: 'absolute',
    left: 4,
    bottom: 4,
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
    paddingRight: 8,
    zIndex: 1,
  },
  pageBackText: {
    fontFamily: FONT,
    fontSize: 17,
    color: '#007AFF',
    marginLeft: -2,
  },
  pageTitle: {
    fontFamily: FONT,
    fontSize: 17,
    fontWeight: '600',
    color: '#000',
    maxWidth: '46%',
  },
  pageBody: {
    flex: 1,
  },
  pageScroll: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 28,
    gap: 8,
  },
  pageTotal: {
    fontFamily: FONT,
    fontSize: 34,
    fontWeight: '700',
    letterSpacing: -0.8,
    color: '#000',
    fontVariant: ['tabular-nums'],
  },
  group: {
    marginTop: 12,
    backgroundColor: '#fff',
    borderRadius: 12,
    overflow: 'hidden',
  },
  groupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 48,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(60, 60, 67, 0.18)',
  },
  groupRowLast: {
    borderBottomWidth: 0,
  },
  groupLabel: {
    flex: 1,
    fontFamily: FONT,
    fontSize: 17,
    color: '#000',
  },
  pageFooter: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 10,
    backgroundColor: '#F2F2F7',
  },
  pagePrimary: {
    flex: 1,
    minHeight: 50,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1F8A4E',
  },
  pagePrimaryText: {
    fontFamily: FONT,
    fontSize: 17,
    fontWeight: '600',
    color: '#fff',
  },
  pageSecondary: {
    flex: 1,
    minHeight: 50,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  pageSecondaryText: {
    fontFamily: FONT,
    fontSize: 17,
    fontWeight: '600',
    color: '#000',
  },
  appleNote: {
    marginTop: 16,
    minHeight: 120,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: '#fff',
    fontFamily: FONT,
    fontSize: 17,
    lineHeight: 22,
    color: '#000',
    textAlignVertical: 'top',
    ...Platform.select({
      web: { outlineStyle: 'none' },
      default: {},
    }),
  },
});
