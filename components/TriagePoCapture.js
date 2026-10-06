import { createElement, useEffect, useRef, useState } from 'react';
import { BlurView } from 'expo-blur';
import * as ImagePicker from 'expo-image-picker';
import {
  ActivityIndicator,
  Animated,
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
import {
  CANVAS,
  MOBILE,
  MOBILE_FILTER_INSET,
  mobileSafeBottom,
  useIsMobile,
} from '../lib/mobileUi';
import { mobileTabBarReserve } from '../lib/mobileTabBar';
import {
  MobileFeedAddButton,
  MobileFeedDangerButton,
  MobileFeedOutlineButton,
  MobileFeedTopBar,
  MobileFeedTopBarActions,
} from './MobileChrome';
import {
  ERROR_TYPES,
  formatErrorAmount,
  isListedErrorType,
  normalizeReviewImages,
} from '../lib/triageDraft';
import {
  deleteTriageErrorType,
  listTriageErrorTypes,
  mergeErrorTypes,
  saveTriageErrorType,
} from '../lib/triageErrorTypes';
import { uploadTriageErrorPhotos } from '../lib/triageErrorPhotos';
import { lookupPurchasesByPoNumber, normalizePoNumber, readPoNumberFromPhoto } from '../lib/triagePoRead';
import { formatAmount, formatUnitCost, purchaseBuyerName } from '../lib/transactions';
import {
  allocationDraftFromPo,
  isAllocationComplete,
  sanitizeAllocation,
  weightPairLabel,
} from '../lib/triageAllocations';
import { lotFromPo } from '../lib/triageLots';
import {
  fileTriagePoToLot,
  persistTransferWorkflowNow,
  saveTriagePoAllocation,
  saveTriagePoReview,
  triageEditorFromSession,
} from '../lib/transferWorkflow';
import { getVideoElement, useWebcam, webcamSupported } from '../lib/webcam';
import { isBullionResaleLine, isScrapJewelleryLine } from '../lib/priceCheck';
import { catalogNameForPurchaseLine, fetchWebsitePrices } from '../lib/websitePrices';
import { ChromeListRow, confirmDestructive, FONT, T } from './TriageKit';
import { PoThumb } from './TriageTable';
import TriageAllocationForm from './TriageAllocationForm';
import TriageCorrectionImages from './TriageCorrectionImages';

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
  const pair = weightPairLabel(line);
  if (pair) return pair;
  const raw = line?.weight;
  if (raw == null || raw === '') return '';
  const n = Number(raw);
  const shown = Number.isFinite(n)
    ? n.toLocaleString('en-CA', { maximumFractionDigits: 3 })
    : String(raw);
  const unit = String(line?.unitType || '').trim();
  return unit ? `${shown} ${unit}` : shown;
}

function lineQuantityLabel(line) {
  const q = line?.quantity;
  if (q == null || q === '') return '';
  const n = Number(q);
  if (!Number.isFinite(n) || n <= 0) return '';
  const shown =
    n % 1 === 0 ? n.toLocaleString('en-CA') : n.toLocaleString('en-CA', { maximumFractionDigits: 3 });
  return `Qty ${shown}`;
}

/** Scrap/jewellery: scale weight. Named bullion (SML, maple, etc.): count. */
function lineShowsGramWeight(line) {
  if (isBullionResaleLine(line)) return false;
  if (isScrapJewelleryLine(line)) return true;
  const w = Number(line?.weight);
  if (!Number.isFinite(w) || w <= 0) return false;
  const payout = Number(line?.payout);
  if (Number.isFinite(payout) && payout > 0) return true;
  return false;
}

function lineUnitCostLabel(line) {
  const unitType = isBullionResaleLine(line) ? 'ea' : line?.unitType;
  return formatUnitCost(line?.unitPrice, unitType);
}

function lineDetailMeta(line) {
  const parts = [];
  if (lineShowsGramWeight(line)) {
    const weight = weightLabel(line);
    if (weight) parts.push(weight);
  } else {
    const qty = lineQuantityLabel(line);
    if (qty) parts.push(qty);
  }
  const unitCost = lineUnitCostLabel(line);
  if (unitCost && unitCost !== '—') parts.push(unitCost);
  return parts;
}

function PoOrderTotal({ amount }) {
  return (
    <View style={styles.poTotalRow}>
      <Text style={styles.poTotalLabel}>Total</Text>
      <Text style={styles.poTotalValue}>{moneyLabel(amount)}</Text>
    </View>
  );
}

function moneyLabel(amount) {
  if (amount == null || !Number.isFinite(Number(amount))) return '—';
  return formatAmount(amount);
}

function matchStoreLabel(row) {
  const store = String(row?.storeName || '').trim();
  if (store && store !== '—') return store;
  return '';
}

function matchPoMeta(row) {
  return [matchStoreLabel(row), row?.dateLabel].filter(Boolean).join(' · ') || 'Store not listed';
}

function lineAmountNumber(value) {
  const amount = Number(String(value ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(amount) ? amount : null;
}

function lineDraftsFromPo(lines) {
  return (Array.isArray(lines) ? lines : []).map((line, index) => {
    const original = line?.originalLineTotal != null ? line.originalLineTotal : line?.lineTotal;
    const current = line?.lineTotal;
    return {
      index,
      originalAmount: original,
      amount: current == null || !Number.isFinite(Number(current)) ? '' : String(current),
    };
  });
}

function changedLineEdits(drafts, lines, catalog) {
  return (drafts || [])
    .map((draft) => {
      const line = lines[draft.index];
      const next = lineAmountNumber(draft.amount);
      const original = lineAmountNumber(draft.originalAmount);
      if (next == null || original == null || Math.abs(next - original) < 0.001) return null;
      return {
        index: draft.index,
        name: lineTitle(line, catalog),
        originalAmount: moneyLabel(draft.originalAmount),
        amount: formatErrorAmount(draft.amount),
      };
    })
    .filter(Boolean);
}

function actorNameOf(session) {
  return triageEditorFromSession(session)?.name || '';
}

function poBuyerLabel(po) {
  return purchaseBuyerName(po) || '—';
}

function PoDetailMetaTable({ po }) {
  const rows = [
    ['Date', po?.dateLabel || '—'],
    ['Store', po?.storeName || '—'],
    ['Customer', po?.customerName || '—'],
    ['Buyer', poBuyerLabel(po)],
  ];
  return (
    <View style={styles.poMetaGroup}>
      {rows.map(([label, value], index) => (
        <View
          key={label}
          style={[styles.poMetaRow, index === rows.length - 1 && styles.poMetaRowLast]}
        >
          <Text style={styles.poMetaLabel}>{label}</Text>
          <Text style={styles.poMetaValue} numberOfLines={2}>
            {value}
          </Text>
        </View>
      ))}
    </View>
  );
}

function lineImageUrls(line, po, extraPhotoUri = '') {
  const fromLine = Array.isArray(line?.imageUrls) ? line.imageUrls.filter(Boolean) : [];
  if (fromLine.length) return fromLine;
  const pricedLines = Array.isArray(po?.pricedLines) ? po.pricedLines : [];
  const poUrls = [
    ...(Array.isArray(po?.imageUrls) ? po.imageUrls : []),
    String(extraPhotoUri || '').trim(),
  ].filter(Boolean);
  if (pricedLines.length === 1 && poUrls.length) return poUrls;
  return [];
}

function PoLineItemsBlock({ lines, buyCatalog, po, photoUri }) {
  if (!lines.length) return null;
  return (
    <View style={styles.poLineGroup}>
      {lines.map((line, index) => {
        const title = lineTitle(line, buyCatalog);
        const urls = lineImageUrls(line, po, photoUri);
        const meta = lineDetailMeta(line);
        const last = index === lines.length - 1;
        return (
          <View key={`${title}-${index}`} style={[styles.poLineRow, last && styles.poLineRowLast]}>
            <View style={styles.poLineThumbCell}>
              <PoThumb urls={urls} label={title} size={44} />
            </View>
            <View style={styles.poLineBody}>
              <View style={styles.poLineTop}>
                <Text style={styles.poLineName} numberOfLines={2}>
                  {title}
                </Text>
                <Text style={styles.poLineTotal}>{moneyLabel(line.lineTotal)}</Text>
              </View>
              {meta.length ? (
                <Text style={styles.poLineMeta} numberOfLines={2}>
                  {meta.join(' · ')}
                </Text>
              ) : null}
            </View>
          </View>
        );
      })}
      <PoOrderTotal amount={po?.amount} />
    </View>
  );
}

function CaptureTopBar({ segments, onBack, trailing, overlay = false }) {
  return (
    <View
      style={[styles.captureTopShell, overlay && styles.captureTopOverlay]}
      pointerEvents="box-none"
    >
      <MobileFeedTopBar
        flushTop
        segments={segments}
        onBrandPress={onBack}
        trailing={trailing}
      />
    </View>
  );
}

function AddedToast({ label, onDone }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const drop = useRef(new Animated.Value(-16)).current;
  const check = useRef(new Animated.Value(0.2)).current;
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    const enter = Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }),
      Animated.spring(drop, { toValue: 0, speed: 16, bounciness: 7, useNativeDriver: true }),
      Animated.spring(check, { toValue: 1, speed: 12, bounciness: 14, useNativeDriver: true }),
    ]);
    enter.start();
    const timer = setTimeout(() => {
      Animated.timing(opacity, { toValue: 0, duration: 280, useNativeDriver: true }).start(({ finished }) => {
        if (finished) onDoneRef.current?.();
      });
    }, 1500);
    return () => {
      clearTimeout(timer);
      enter.stop();
    };
  }, [check, drop, opacity]);

  return (
    <Animated.View pointerEvents="none" style={[styles.addedToast, { opacity, transform: [{ translateY: drop }] }]}>
      <BlurView intensity={72} tint="light" style={styles.addedBlur}>
        <Animated.View style={[styles.addedCheck, { transform: [{ scale: check }] }]}>
          <Ionicons name="checkmark" size={16} color="#fff" />
        </Animated.View>
        <Text style={styles.addedText} numberOfLines={1}>
          {label}
        </Text>
      </BlurView>
    </Animated.View>
  );
}

function isBuiltinErrorType(label) {
  const key = String(label || '').trim().toLowerCase();
  return ERROR_TYPES.some((row) => row.toLowerCase() === key);
}

function MobileErrorTypePicker({ types, value, onChange, onAdd, onRemove, disabled }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const [addError, setAddError] = useState('');
  const [savingType, setSavingType] = useState(false);
  const needle = query.trim().toLowerCase();
  const shown = needle ? types.filter((label) => label.toLowerCase().includes(needle)) : types;

  const pick = (label) => {
    onChange(label === value ? '' : label);
    setOpen(false);
    setQuery('');
    setAdding(false);
  };

  const submit = async () => {
    const label = draft.trim();
    if (!isListedErrorType(label) || savingType) return;
    setSavingType(true);
    setAddError('');
    try {
      const saved = await onAdd(label);
      onChange(saved || label);
      setDraft('');
      setAdding(false);
      setQuery('');
      setOpen(false);
    } catch (err) {
      setAddError(err?.message || 'Could not save that error type.');
    } finally {
      setSavingType(false);
    }
  };

  const tryRemoveType = (label) => {
    if (disabled || !onRemove || isBuiltinErrorType(label)) return;
    confirmDestructive(
      'Remove error type',
      `Remove “${label}” for everyone?`,
      () => void onRemove(label),
      'Remove',
    );
  };

  return (
    <>
      <View style={[styles.poMetaRow, styles.errorPickerRow]}>
        <Text style={styles.poMetaLabel}>Error type</Text>
        <Pressable
          style={styles.errorPickerValueHit}
          onPress={() => !disabled && setOpen(true)}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityLabel="Select error type"
        >
          <Text
            style={[styles.errorPickerValue, !value && styles.errorFieldPlaceholder]}
            numberOfLines={1}
          >
            {value || 'Select…'}
          </Text>
        </Pressable>
        {value ? (
          <Pressable
            onPress={() => onChange('')}
            disabled={disabled}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Clear error type"
          >
            <Ionicons name="close-circle-outline" size={20} color={MOBILE.secondary} />
          </Pressable>
        ) : null}
        <Pressable
          onPress={() => !disabled && setOpen(true)}
          disabled={disabled}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Open error type list"
        >
          <Ionicons name="chevron-forward" size={18} color="#c7c7cc" />
        </Pressable>
      </View>
      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <KeyboardAvoidingView
          style={styles.errorTypeSheet}
          behavior={Platform.OS === 'android' ? undefined : 'padding'}
        >
          <View style={styles.errorTypeSheetHeader}>
            <Pressable onPress={() => setOpen(false)} hitSlop={8} accessibilityLabel="Close">
              <Text style={styles.errorTypeSheetClose}>Cancel</Text>
            </Pressable>
            <Text style={styles.errorTypeSheetTitle}>Error type</Text>
            <View style={styles.errorTypeSheetHeaderSpacer} />
          </View>
          <View style={[styles.poMetaGroup, styles.errorTypeSearchGroup]}>
            <TextInput
              style={styles.errorTypeSearch}
              value={query}
              onChangeText={setQuery}
              placeholder="Search"
              placeholderTextColor={MOBILE.secondary}
              editable={!disabled}
              autoCorrect={false}
              clearButtonMode="while-editing"
              accessibilityLabel="Search error types"
            />
          </View>
          <ScrollView
            style={styles.errorTypeSheetBody}
            contentContainerStyle={styles.errorTypeSheetScroll}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.poMetaGroup}>
              {shown.map((label, index) => {
                const selected = value === label;
                const last = index === shown.length - 1 && !adding;
                const removable = onRemove && !isBuiltinErrorType(label);
                return (
                  <View
                    key={label}
                    style={[styles.poMetaRow, last && styles.poMetaRowLast, styles.errorTypeOption]}
                  >
                    <Pressable
                      style={styles.errorTypeOptionMain}
                      onPress={() => pick(label)}
                      disabled={disabled}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                    >
                      <Text style={styles.errorTypeOptionLabel} numberOfLines={2}>
                        {label}
                      </Text>
                      {selected ? <Ionicons name="checkmark" size={20} color={MOBILE.label} /> : null}
                    </Pressable>
                    {removable ? (
                      <Pressable
                        onPress={() => tryRemoveType(label)}
                        disabled={disabled}
                        hitSlop={8}
                        style={styles.errorTypeRemoveBtn}
                        accessibilityRole="button"
                        accessibilityLabel={`Remove ${label}`}
                      >
                        <Ionicons name="trash-outline" size={18} color="#B91C1C" />
                      </Pressable>
                    ) : null}
                  </View>
                );
              })}
              {shown.length === 0 && !adding ? (
                <Text style={styles.errorTypeEmpty}>No matching types</Text>
              ) : null}
              {adding ? (
                <View style={[styles.poMetaRow, styles.poMetaRowLast, styles.errorTypeAddRow]}>
                  <TextInput
                    style={styles.errorTypeAddInput}
                    value={draft}
                    onChangeText={setDraft}
                    placeholder="New error type"
                    placeholderTextColor={MOBILE.secondary}
                    editable={!disabled && !savingType}
                    autoFocus
                    onSubmitEditing={() => void submit()}
                    accessibilityLabel="New error type"
                  />
                  <Pressable onPress={() => void submit()} disabled={disabled || savingType}>
                    <Text style={styles.errorTypeAddSave}>{savingType ? 'Saving…' : 'Add'}</Text>
                  </Pressable>
                </View>
              ) : (
                <Pressable
                  style={[styles.poMetaRow, styles.poMetaRowLast, styles.errorTypeAddLink]}
                  onPress={() => {
                    setAdding(true);
                    setAddError('');
                  }}
                  disabled={disabled}
                  accessibilityRole="button"
                  accessibilityLabel="Add error type"
                >
                  <Ionicons name="add" size={20} color={MOBILE.label} />
                  <Text style={styles.errorTypeAddLinkText}>Add error type</Text>
                </Pressable>
              )}
            </View>
            {addError ? <Text style={styles.errorTypeAddError}>{addError}</Text> : null}
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

function ErrorTypePicker({ types, value, onChange, onAdd, disabled }) {
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const [addError, setAddError] = useState('');
  const [savingType, setSavingType] = useState(false);
  const needle = query.trim().toLowerCase();
  const shown = needle ? types.filter((label) => label.toLowerCase().includes(needle)) : types;

  const submit = async () => {
    const label = draft.trim();
    if (!isListedErrorType(label) || savingType) return;
    setSavingType(true);
    setAddError('');
    try {
      const saved = await onAdd(label);
      onChange(saved || label);
      setDraft('');
      setAdding(false);
      setQuery('');
    } catch (err) {
      setAddError(err?.message || 'Could not save that error type.');
    } finally {
      setSavingType(false);
    }
  };

  return (
    <View style={styles.group}>
      <TextInput
        style={styles.typeSearch}
        value={query}
        onChangeText={setQuery}
        placeholder="Search error types"
        placeholderTextColor="#8E8E93"
        editable={!disabled}
        autoCorrect={false}
        accessibilityLabel="Search error types"
      />
      {shown.map((label) => {
        const selected = value === label;
        return (
          <Pressable
            key={label}
            style={styles.groupRow}
            onPress={() => onChange(selected ? '' : label)}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityState={{ selected }}
          >
            <Text style={styles.groupLabel}>{label}</Text>
            {selected ? <Ionicons name="checkmark" size={20} color="#1a1a1a" /> : null}
          </Pressable>
        );
      })}
      {shown.length === 0 && !adding ? (
        <Text style={styles.typeEmpty}>No matching types</Text>
      ) : null}
      {adding ? (
        <View style={[styles.groupRow, styles.groupRowLast, styles.typeAddRow]}>
          <TextInput
            style={styles.typeAddInput}
            value={draft}
            onChangeText={setDraft}
            placeholder="New error type"
            placeholderTextColor="#8E8E93"
            editable={!disabled && !savingType}
            autoFocus
            onSubmitEditing={() => void submit()}
            accessibilityLabel="New error type"
          />
          <Pressable onPress={() => void submit()} disabled={disabled || savingType} accessibilityRole="button">
            <Text style={styles.typeAddSave}>{savingType ? 'Saving…' : 'Save'}</Text>
          </Pressable>
        </View>
      ) : (
        <Pressable
          style={[styles.groupRow, styles.groupRowLast]}
          onPress={() => {
            setAdding(true);
            setAddError('');
          }}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityLabel="Add error type"
        >
          <Ionicons name="add" size={18} color="#1a1a1a" />
          <Text style={styles.typeAddLink}>Add error type</Text>
        </Pressable>
      )}
      {addError ? <Text style={styles.typeAddError}>{addError}</Text> : null}
    </View>
  );
}

export default function TriagePoCapture({ session, openerRef, onFlowOpenChange }) {
  const isMobile = useIsMobile();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
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
  const [allocating, setAllocating] = useState(false);
  const [allocDraft, setAllocDraft] = useState({ lines: [] });
  const [pendingError, setPendingError] = useState(false);
  const [errorMode, setErrorMode] = useState(false);
  const [errorNote, setErrorNote] = useState('');
  const [errorType, setErrorType] = useState('');
  const [errorAmount, setErrorAmount] = useState('');
  const [errorImages, setErrorImages] = useState([]);
  const [lineDrafts, setLineDrafts] = useState([]);
  const [savedErrorTypes, setSavedErrorTypes] = useState([]);
  const errorTypes = mergeErrorTypes(savedErrorTypes);
  const errorPhotosRef = useRef(null);

  useEffect(() => {
    if (!errorMode) return undefined;
    let cancelled = false;
    listTriageErrorTypes()
      .then((labels) => {
        if (!cancelled) setSavedErrorTypes(labels);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [errorMode]);

  const addSharedErrorType = async (label) => {
    const saved = await saveTriageErrorType(label);
    setSavedErrorTypes((current) => mergeErrorTypes([...current, saved]));
    return saved;
  };

  const removeSharedErrorType = async (label) => {
    await deleteTriageErrorType(label);
    setSavedErrorTypes((current) =>
      current.filter((row) => String(row || '').trim().toLowerCase() !== String(label || '').trim().toLowerCase()),
    );
    setErrorType((current) =>
      String(current || '').trim().toLowerCase() === String(label || '').trim().toLowerCase() ? '' : current,
    );
  };
  const [resultError, setResultError] = useState('');
  const [finishing, setFinishing] = useState(false);
  const [notice, setNotice] = useState('');
  const [toast, setToast] = useState(null);
  const [needsSettings, setNeedsSettings] = useState(false);
  const [buyCatalog, setBuyCatalog] = useState(null);
  const [previewBox, setPreviewBox] = useState({ width: 0, height: 0 });
  const [poEntry, setPoEntry] = useState(false);
  const [errorSheetOpen, setErrorSheetOpen] = useState(false);
  const requestRef = useRef(0);
  const openRef = useRef(false);
  openRef.current = open;

  useEffect(() => {
    onFlowOpenChange?.(open);
    return () => onFlowOpenChange?.(false);
  }, [onFlowOpenChange, open]);
  const onSnapCamera =
    !isMobile || (!resultOpen && !allocating && !errorSheetOpen && matches.length <= 1);
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
    setAllocating(false);
    setAllocDraft({ lines: [] });
    setPendingError(false);
    setErrorMode(false);
    setErrorNote('');
    setErrorType('');
    setErrorAmount('');
    setErrorImages([]);
    setLineDrafts([]);
    setResultError('');
    setFinishing(false);
    setNotice('');
    setToast(null);
    setNeedsSettings(false);
    setPoEntry(false);
    setErrorSheetOpen(false);
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
    const rows = await lookupPurchasesByPoNumber(session, id, {
      onHit: (_row, all) => {
        if (token !== requestRef.current) return;
        setMatches(all);
        setPo(all[0]);
        setPhase('Checking other stores…');
      },
    });
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
    setErrorAmount('');
    setErrorImages([]);
    setLineDrafts(lineDraftsFromPo(row?.pricedLines));
    setResultError('');
    setErrorSheetOpen(false);
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
        setError('Could not read a PO number from that photo. Tap PO #.');
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
    setAllocating(false);
    setAllocDraft({ lines: [] });
    setPendingError(false);
    setErrorMode(false);
    setErrorNote('');
    setErrorType('');
    setErrorAmount('');
    setErrorImages([]);
    setLineDrafts([]);
    setResultError('');
    setPoEntry(false);
    setErrorSheetOpen(false);
    if (isMobile) return;
    if (liveCamera) void startCamera();
    else void launchDeviceCamera();
  };

  const goPoDetailsFromError = () => {
    setErrorSheetOpen(false);
    setResultError('');
  };

  const goScanPoCamera = () => {
    requestRef.current += 1;
    setErrorSheetOpen(false);
    setResultOpen(false);
    setAllocating(false);
    setPendingError(false);
    setPo(null);
    setMatches([]);
    setResultError('');
    setPoInput('');
    setPhotoUri('');
    setPhase('');
    setError('');
    setBusy(false);
    setPoEntry(false);
    setErrorMode(false);
    setErrorNote('');
    setErrorType('');
    setErrorAmount('');
    setErrorImages([]);
    setLineDrafts([]);
  };

  const leaveMobilePage = () => {
    if (allocating) {
      setAllocating(false);
      setResultError('');
      if (pendingError) setErrorSheetOpen(true);
      return;
    }
    if (errorSheetOpen) {
      goPoDetailsFromError();
      return;
    }
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

  const goAllocate = (withError) => {
    if (!po || finishing) return;
    const note = errorNote.trim();
    const amount = errorAmount.trim();
    const photos = normalizeReviewImages(errorImages);
    const lineEdits = changedLineEdits(lineDrafts, lines, buyCatalog);
    if (withError && !note && !errorType && !amount && !photos.length && !lineEdits.length) {
      setResultError('Add a note, set amount, photo, line change, or pick an error type.');
      return;
    }
    setPendingError(Boolean(withError));
    setAllocDraft(allocationDraftFromPo(po, (line) => lineTitle(line, buyCatalog)));
    setAllocating(true);
    setErrorMode(false);
    setErrorSheetOpen(false);
    setResultError('');
  };

  const saveErrorSheet = () => {
    const note = errorNote.trim();
    const amount = errorAmount.trim();
    const photos = normalizeReviewImages(errorImages);
    const lineEdits = changedLineEdits(lineDrafts, lines, buyCatalog);
    if (!note && !errorType && !amount && !photos.length && !lineEdits.length) {
      setResultError('Pick an error type, add details, amount, or a photo.');
      return;
    }
    setPendingError(true);
    setErrorSheetOpen(false);
    setResultError('');
  };

  const promptErrorPhoto = () => {
    if (finishing) return;
    errorPhotosRef.current?.addImage?.();
  };

  const finishPo = async ({ skipAllocation = false } = {}) => {
    if (!po || finishing) return;
    if (!skipAllocation && !isAllocationComplete(allocDraft)) {
      setResultError('Allocate the full object weight of each line before finishing.');
      return;
    }
    const note = errorNote.trim();
    const amount = errorAmount.trim();
    const photos = normalizeReviewImages(errorImages);
    const lineEdits = changedLineEdits(lineDrafts, lines, buyCatalog);
    const saveError = pendingError || errorMode;
    if (saveError && !note && !errorType && !amount && !photos.length && !lineEdits.length) {
      setResultError('Add a note, set amount, photo, line change, or pick an error type.');
      return;
    }
    const actor = actorNameOf(session);
    const editor = triageEditorFromSession(session);
    setFinishing(true);
    setResultError('');
    try {
      const result = fileTriagePoToLot(po, actor);
      if (!result.ok) {
        setResultError(`${po.reference || 'This PO'} could not be added to a lot.`);
        return;
      }
      const poId = result.item?.id || po.id;
      if (saveError) {
        const images = photos.length ? await uploadTriageErrorPhotos(photos, poId) : [];
        saveTriagePoReview(
          poId,
          { note, errorType, errorAmount: formatErrorAmount(amount), images, lineEdits },
          editor,
        );
      }
      if (!skipAllocation) {
        saveTriagePoAllocation(poId, sanitizeAllocation(allocDraft) || allocDraft, editor);
      }
      persistTransferWorkflowNow().catch(() => {});
      const label = po.reference || `PO#${normalizePoNumber(poInput) || po.id}`;
      const lotName = result.lot?.id || lotFromPo(po).id;
      setToast({ id: Date.now(), label: `${label} added to ${lotName}` });
      nextPo();
    } catch (err) {
      setResultError(err?.message || 'Could not add this PO to a lot.');
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
  const poFieldWidth = Math.min(168, Math.max(112, (windowWidth - 132) / 2));

  const lines = Array.isArray(po?.pricedLines) ? po.pricedLines : [];
  const updateLineAmount = (index, value) => {
    setLineDrafts((current) => current.map((draft) => (draft.index === index ? { ...draft, amount: value } : draft)));
  };
  const lineEditor = lineDrafts.length ? (
    <>
      <Text style={styles.sectionLabel}>Line items</Text>
      <View style={styles.group}>
        {lineDrafts.map((draft, index) => {
          const line = lines[draft.index];
          const title = lineTitle(line, buyCatalog);
          const last = index === lineDrafts.length - 1;
          return (
            <View key={`${title}-${draft.index}`} style={[styles.lineEdit, last && styles.groupRowLast]}>
              <Text style={styles.lineName} numberOfLines={2}>{title}</Text>
              <View style={styles.lineEditAmounts}>
                <View style={styles.lineEditWas}>
                  <Text style={styles.lineEditCaption}>Was</Text>
                  <Text style={styles.lineMoney}>{moneyLabel(draft.originalAmount)}</Text>
                </View>
                <View style={styles.lineEditNow}>
                  <Text style={styles.lineEditCaption}>Now</Text>
                  <TextInput
                    style={styles.lineEditInput}
                    value={draft.amount}
                    onChangeText={(value) => updateLineAmount(draft.index, value)}
                    placeholder="0.00"
                    placeholderTextColor="#8E8E93"
                    keyboardType="decimal-pad"
                    editable={!finishing}
                    accessibilityLabel={`Updated amount for ${title}`}
                  />
                </View>
              </View>
            </View>
          );
        })}
      </View>
    </>
  ) : null;
  const destLot = po ? lotFromPo(po) : null;
  const placeLine = destLot
    ? `Adds to ${destLot.id}`
    : 'Adds this purchase to its lot on Results.';
  if (openerRef) openerRef.current = openCapture;

  const dockPad = 16 + mobileTabBarReserve() + mobileSafeBottom();
  const poRefLabel = po?.reference || 'PO';
  const mobileErrorForm = (
    <>
      <View style={[styles.poMetaGroup, styles.errorFormGroup]}>
        <MobileErrorTypePicker
          types={errorTypes}
          value={errorType}
          onChange={setErrorType}
          onAdd={addSharedErrorType}
          onRemove={removeSharedErrorType}
          disabled={finishing}
        />
        <View style={[styles.poMetaRow, styles.errorFieldBlock]}>
          <Text style={styles.errorFieldCaption}>Error dollar amount</Text>
          <TextInput
            style={styles.errorAmountInput}
            value={errorAmount}
            onChangeText={setErrorAmount}
            placeholder="0.00"
            placeholderTextColor={MOBILE.secondary}
            keyboardType="decimal-pad"
            editable={!finishing}
            accessibilityLabel="Error dollar amount"
          />
        </View>
        <View style={[styles.poMetaRow, styles.poMetaRowLast, styles.errorFieldBlock]}>
          <Text style={styles.errorFieldCaption}>Details</Text>
          <TextInput
            style={styles.errorDetailsInput}
            value={errorNote}
            onChangeText={setErrorNote}
            placeholder="What went wrong?"
            placeholderTextColor={MOBILE.secondary}
            multiline
            editable={!finishing}
            accessibilityLabel="Error details"
          />
        </View>
      </View>
      <View style={[styles.poMetaGroup, styles.errorPhotoGroup]}>
        <TriageCorrectionImages
          ref={errorPhotosRef}
          images={errorImages}
          onChange={setErrorImages}
          hideHeading
          hideActions
          insetCard
          readOnly={finishing}
        />
      </View>
    </>
  );
  const mobileFlow = (
    <View style={styles.mobileRoot}>
      {allocating && po ? (
        <View style={styles.page}>
          <CaptureTopBar
            segments={[{ label: 'Scan PO' }, { label: poRefLabel }, { label: 'Allocate' }]}
            onBack={leaveMobilePage}
          />
          <ScrollView style={styles.pageBody} contentContainerStyle={styles.pageScrollFeed}>
            <Text style={styles.pageSectionTitle}>Allocation</Text>
            <Text style={styles.pageDetailNote}>
              Split each line by object weight. Totals must match before you finish, or skip allocation.
            </Text>
            <View style={styles.feedSheet}>
              <TriageAllocationForm draft={allocDraft} onChange={setAllocDraft} disabled={finishing} />
            </View>
            {resultError ? <Text style={styles.error}>{resultError}</Text> : null}
          </ScrollView>
          <View style={[styles.pageFooter, { paddingBottom: dockPad }]}>
            <Pressable
              style={[styles.pageSecondary, finishing && styles.lookupOff]}
              onPress={() => void finishPo({ skipAllocation: true })}
              disabled={finishing}
              accessibilityRole="button"
              accessibilityLabel="Skip allocation and finish"
            >
              <Text style={styles.pageSecondaryText}>{finishing ? 'Saving…' : 'Skip allocation'}</Text>
            </Pressable>
            <Pressable
              style={[styles.pagePrimary, finishing && styles.lookupOff]}
              onPress={() => void finishPo()}
              disabled={finishing}
              accessibilityRole="button"
              accessibilityLabel="Finish"
            >
              <Text style={styles.pagePrimaryText}>{finishing ? 'Saving…' : 'Finish'}</Text>
            </Pressable>
          </View>
        </View>
      ) : errorSheetOpen && resultOpen && po ? (
        <KeyboardAvoidingView
          style={styles.page}
          behavior={Platform.OS === 'android' ? undefined : 'padding'}
        >
          <CaptureTopBar
            segments={[
              { label: 'Scan PO', onPress: goScanPoCamera },
              { label: poRefLabel, onPress: goPoDetailsFromError },
              { label: 'Error' },
            ]}
            onBack={goPoDetailsFromError}
            trailing={
              <MobileFeedTopBarActions>
                <MobileFeedOutlineButton
                  label="Photo"
                  leadingIcon="add"
                  onPress={promptErrorPhoto}
                  disabled={finishing}
                  accessibilityLabel="Add photo"
                />
                <MobileFeedAddButton
                  label="Save"
                  onPress={saveErrorSheet}
                  disabled={finishing}
                  accessibilityLabel="Save error"
                />
              </MobileFeedTopBarActions>
            }
          />
          <ScrollView
            style={styles.pageBody}
            contentContainerStyle={[styles.pageScrollFeed, { paddingBottom: dockPad }]}
            keyboardShouldPersistTaps="handled"
          >
            {mobileErrorForm}
            {resultError ? <Text style={styles.error}>{resultError}</Text> : null}
          </ScrollView>
        </KeyboardAvoidingView>
      ) : resultOpen && po ? (
        <View style={styles.page}>
          <CaptureTopBar
            segments={[{ label: 'Scan PO' }, { label: poRefLabel }]}
            onBack={leaveMobilePage}
            trailing={
              <MobileFeedTopBarActions>
                <MobileFeedDangerButton
                  label={pendingError ? 'Edit error' : 'Add error'}
                  onPress={() => {
                    setResultError('');
                    setErrorSheetOpen(true);
                  }}
                  disabled={finishing}
                  accessibilityLabel={pendingError ? 'Edit error' : 'Add error'}
                />
                <MobileFeedAddButton
                  label="Next"
                  onPress={() => goAllocate(Boolean(pendingError))}
                  disabled={finishing}
                  accessibilityLabel="Next"
                />
              </MobileFeedTopBarActions>
            }
          />
          <ScrollView
            style={styles.pageBody}
            contentContainerStyle={[styles.pageScrollFeed, { paddingBottom: dockPad }]}
          >
            <PoDetailMetaTable po={po} />
            {lines.length ? (
              <>
                <Text style={styles.pageSectionTitle}>Line items</Text>
                <PoLineItemsBlock lines={lines} buyCatalog={buyCatalog} po={po} photoUri={photoUri} />
              </>
            ) : (
              <Text style={styles.pageDetailNote}>No line items on this purchase.</Text>
            )}
            {resultError ? <Text style={styles.error}>{resultError}</Text> : null}
          </ScrollView>
        </View>
      ) : matches.length > 1 ? (
        <View style={styles.page}>
          <CaptureTopBar
            segments={[{ label: 'Scan PO' }, { label: 'Choose PO' }]}
            onBack={leaveMobilePage}
          />
          <ScrollView style={styles.pageBody} contentContainerStyle={styles.pageScrollFeed}>
            <Text style={styles.pageSectionTitle}>Choose purchase</Text>
            <Text style={styles.pageDetailNote}>More than one purchase uses this number.</Text>
            <View style={styles.feedList}>
              {matches.map((row, index) => (
                <ChromeListRow
                  key={row.id}
                  title={row.reference}
                  meta={matchPoMeta(row)}
                  value={moneyLabel(row.amount)}
                  icon="document-text-outline"
                  iconColor="#1F7A9A"
                  onPress={() => openResult(row)}
                  last={index === matches.length - 1}
                />
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
          <CaptureTopBar
            overlay
            segments={[{ label: 'Scan PO' }]}
            onBack={close}
            trailing={
              photoUri ? (
                <MobileFeedOutlineButton label="Retake" onPress={retake} accessibilityLabel="Retake photo" />
              ) : null
            }
          />
          <KeyboardAvoidingView
            style={styles.snapOverlay}
            behavior={Platform.OS === 'android' ? undefined : 'padding'}
            pointerEvents="box-none"
          >
            {toast ? <AddedToast key={toast.id} label={toast.label} onDone={() => setToast(null)} /> : null}
            {phase || error ? (
              <View style={styles.snapStatus} pointerEvents="none">
                {phase ? <Text style={styles.snapPhase}>{phase}</Text> : null}
                {error ? <Text style={styles.snapError}>{error}</Text> : null}
              </View>
            ) : null}
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
              <View style={styles.snapControls}>
                {!poEntry && !photoUri ? <View style={styles.poChipBalance} /> : null}
                {photoUri ? null : (
                  <Pressable
                    style={[styles.snapShutter, (busy || (liveCamera && cameraState !== 'live')) && styles.shutterOff]}
                    onPress={onShutter}
                    disabled={busy || (liveCamera && cameraState !== 'live')}
                    accessibilityRole="button"
                    accessibilityLabel="Take photo"
                  >
                    <BlurView intensity={42} tint="light" style={styles.snapShutterBlur}>
                      <View style={styles.snapShutterCore} />
                    </BlurView>
                  </Pressable>
                )}
                {poEntry ? (
                  <BlurView intensity={48} tint="light" style={[styles.poEntryBlur, { width: poFieldWidth }]}>
                    <TextInput
                      style={styles.poEntryInput}
                      value={poInput}
                      onChangeText={setPoInput}
                      placeholder="PO #"
                      placeholderTextColor="rgba(60,60,67,0.55)"
                      keyboardType="number-pad"
                      returnKeyType="search"
                      underlineColorAndroid="transparent"
                      autoFocus
                      editable={!busy}
                      onSubmitEditing={() => void lookupTyped()}
                      onBlur={() => {
                        if (!poInput.trim()) setPoEntry(false);
                      }}
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
                        {busy ? <ActivityIndicator color="#1a1a1a" /> : <Text style={styles.poEntryGo}>Go</Text>}
                      </Pressable>
                    ) : null}
                  </BlurView>
                ) : (
                  <Pressable
                    style={styles.poChipButton}
                    onPress={() => setPoEntry(true)}
                    disabled={busy}
                    accessibilityRole="button"
                    accessibilityLabel="Enter PO number"
                  >
                    <BlurView intensity={48} tint="light" style={styles.poChipBlur}>
                      <Text style={styles.poChipText}>PO #</Text>
                    </BlurView>
                  </Pressable>
                )}
              </View>
            </View>
          </KeyboardAvoidingView>
        </View>
      )}
    </View>
  );

  return (
    <>
    {isMobile ? (
      open ? mobileFlow : null
    ) : (
    <Modal
      visible={open}
      transparent
      animationType="fade"
      onRequestClose={close}
    >
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
                          {matchPoMeta(row)}
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
    </Modal>
    )}

    <Modal
      visible={open && resultOpen && Boolean(po) && !isMobile}
      transparent
      animationType={isMobile ? 'slide' : 'fade'}
      onRequestClose={() => {
        if (allocating) {
          setAllocating(false);
          return;
        }
        setResultOpen(false);
      }}
    >
      <KeyboardAvoidingView
        style={[styles.backdrop, isMobile && styles.backdropSheet]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={() => {
            if (allocating) {
              setAllocating(false);
              return;
            }
            setResultOpen(false);
          }}
        />
        <View style={[styles.resultSheet, isMobile && styles.resultSheetMobile]} accessibilityViewIsModal>
          {isMobile ? <View style={styles.grabber} /> : null}
          <View style={styles.header}>
            <Text style={styles.title} numberOfLines={1}>{allocating ? 'Allocate' : po?.reference || 'PO'}</Text>
            <Pressable
              onPress={() => {
                if (allocating) {
                  setAllocating(false);
                  setResultError('');
                  if (pendingError) setErrorMode(true);
                  return;
                }
                setResultOpen(false);
              }}
              hitSlop={8}
              accessibilityLabel="Close"
            >
              <Text style={styles.resultClose}>{allocating ? 'Back' : 'Close'}</Text>
            </Pressable>
          </View>
          <ScrollView
            style={errorMode || allocating ? styles.resultScroll : null}
            contentContainerStyle={styles.resultContent}
            keyboardShouldPersistTaps="handled"
          >
            {allocating ? (
              <>
                <Text style={styles.resultKicker}>{po?.reference || 'PO'}</Text>
                <Text style={styles.detailMeta}>
                  Split each line by object weight. Totals must match before you finish, or skip allocation.
                </Text>
                <TriageAllocationForm draft={allocDraft} onChange={setAllocDraft} disabled={finishing} />
                {resultError ? <Text style={styles.error}>{resultError}</Text> : null}
              </>
            ) : (
              <>
            <PoDetailMetaTable po={po} />
            {lines.length ? (
              <PoLineItemsBlock lines={lines} buyCatalog={buyCatalog} po={po} photoUri={photoUri} />
            ) : (
              <Text style={styles.detailMeta}>No line items on this purchase.</Text>
            )}

            <Text style={styles.placeLine}>{placeLine}</Text>

            {errorMode ? (
              <View style={styles.errorBox}>
                <Text style={styles.fieldLabel}>Error</Text>
                <ErrorTypePicker
                  types={errorTypes}
                  value={errorType}
                  onChange={setErrorType}
                  onAdd={addSharedErrorType}
                  disabled={finishing}
                />
                <TextInput
                  style={styles.note}
                  value={errorNote}
                  onChangeText={setErrorNote}
                  placeholder="Error Details"
                  placeholderTextColor={T.secondary}
                  multiline
                  editable={!finishing}
                  accessibilityLabel="Error note"
                />
                <Text style={styles.sectionLabel}>Set amount</Text>
                <TextInput
                  style={styles.amountInput}
                  value={errorAmount}
                  onChangeText={setErrorAmount}
                  placeholder="0.00"
                  placeholderTextColor="#8E8E93"
                  keyboardType="decimal-pad"
                  editable={!finishing}
                  accessibilityLabel="Set amount"
                />
                {lineEditor}
                <Text style={styles.sectionLabel}>Photos</Text>
                <TriageCorrectionImages
                  images={errorImages}
                  onChange={setErrorImages}
                  showSourceButtons
                  captureButtons
                  hideHeading
                  hideActions
                  readOnly={finishing}
                />
              </View>
            ) : null}
            {resultError ? <Text style={styles.error}>{resultError}</Text> : null}
              </>
            )}
          </ScrollView>
          <View style={[styles.resultActions, isMobile && styles.resultActionsMobile]}>
            {allocating ? (
              <>
                <Pressable
                  style={[styles.secondary, finishing && styles.lookupOff]}
                  onPress={() => void finishPo({ skipAllocation: true })}
                  disabled={finishing}
                  accessibilityRole="button"
                  accessibilityLabel="Skip allocation and finish"
                >
                  <Text style={styles.secondaryText}>{finishing ? 'Saving…' : 'Skip allocation'}</Text>
                </Pressable>
                <Pressable
                  style={[styles.next, finishing && styles.lookupOff]}
                  onPress={() => void finishPo()}
                  disabled={finishing}
                  accessibilityRole="button"
                  accessibilityLabel="Finish"
                >
                  <Text style={styles.nextText}>{finishing ? 'Saving…' : 'Finish'}</Text>
                </Pressable>
              </>
            ) : errorMode ? (
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
                  style={[styles.secondary, finishing && styles.lookupOff]}
                  onPress={() => void finishPo({ skipAllocation: true })}
                  disabled={finishing}
                  accessibilityRole="button"
                  accessibilityLabel="Skip allocation and finish"
                >
                  <Text style={styles.secondaryText}>{finishing ? 'Saving…' : 'Skip allocation'}</Text>
                </Pressable>
                <Pressable
                  style={[styles.next, finishing && styles.lookupOff]}
                  onPress={() => goAllocate(true)}
                  disabled={finishing}
                  accessibilityRole="button"
                  accessibilityLabel="Next"
                >
                  <Text style={styles.nextText}>Next</Text>
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
                  style={[styles.secondary, finishing && styles.lookupOff]}
                  onPress={() => void finishPo({ skipAllocation: true })}
                  disabled={finishing}
                  accessibilityRole="button"
                  accessibilityLabel="Skip allocation and finish"
                >
                  <Text style={styles.secondaryText}>{finishing ? 'Saving…' : 'Skip allocation'}</Text>
                </Pressable>
                <Pressable
                  style={[styles.next, finishing && styles.lookupOff]}
                  onPress={() => goAllocate(false)}
                  disabled={finishing}
                  accessibilityRole="button"
                  accessibilityLabel="Next"
                >
                  <Text style={styles.nextText}>Next</Text>
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
    flexWrap: 'wrap',
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
  captureTopShell: {
    flexShrink: 0,
  },
  captureTopOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    width: '100%',
    zIndex: 30,
  },
  mobileRoot: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 20,
    backgroundColor: CANVAS,
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
  snapTopActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
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
  snapControls: {
    width: '100%',
    height: 84,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 28,
  },
  snapStatus: {
    alignItems: 'center',
    paddingHorizontal: 24,
    gap: 6,
  },
  poChipBalance: {
    width: 54,
    height: 54,
  },
  poChipButton: {
    width: 54,
    height: 54,
  },
  poChipBlur: {
    width: 54,
    height: 54,
    borderRadius: 27,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.42)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.72)',
  },
  poChipText: {
    fontFamily: FONT,
    fontSize: 13,
    fontWeight: '700',
    color: '#1d1d1f',
    letterSpacing: -0.2,
  },
  poEntryBlur: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.42)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.72)',
  },
  poEntryInput: {
    flex: 1,
    minWidth: 0,
    minHeight: 44,
    paddingVertical: 0,
    fontFamily: FONT,
    fontSize: 17,
    color: '#1d1d1f',
    backgroundColor: 'transparent',
    ...Platform.select({
      web: { outlineStyle: 'none' },
      default: {},
    }),
  },
  poEntryGo: {
    fontFamily: FONT,
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a1a',
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
  snapShutter: {
    width: 84,
    height: 84,
    alignItems: 'center',
    justifyContent: 'center',
  },
  snapShutterBlur: {
    width: 78,
    height: 78,
    borderRadius: 39,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.28)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.7)',
  },
  snapShutterCore: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: 'rgba(255,255,255,0.38)',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.85)',
  },
  addedToast: {
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 8,
    zIndex: 40,
  },
  addedBlur: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    maxWidth: '100%',
    paddingVertical: 8,
    paddingLeft: 8,
    paddingRight: 16,
    borderRadius: 22,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.55)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.8)',
  },
  addedCheck: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1F8A4E',
  },
  addedText: {
    flexShrink: 1,
    fontFamily: FONT,
    fontSize: 16,
    fontWeight: '600',
    color: '#1d1d1f',
    letterSpacing: -0.2,
  },
  page: {
    flex: 1,
    backgroundColor: CANVAS,
  },
  pageBody: {
    flex: 1,
  },
  pageScrollFeed: {
    paddingBottom: 28,
    gap: 8,
    flexGrow: 1,
  },
  pageSectionTitle: {
    fontFamily: FONT,
    fontSize: 13,
    fontWeight: '400',
    color: MOBILE.secondary,
    letterSpacing: -0.08,
    textTransform: 'uppercase',
    paddingHorizontal: MOBILE_FILTER_INSET,
    paddingTop: 8,
  },
  pageDetailNote: {
    fontFamily: FONT,
    fontSize: 13,
    lineHeight: 18,
    color: MOBILE.secondary,
    paddingHorizontal: MOBILE_FILTER_INSET,
  },
  feedList: {
    marginTop: 8,
    backgroundColor: '#fff',
    width: '100%',
    alignSelf: 'stretch',
    overflow: 'hidden',
  },
  poMetaGroup: {
    marginTop: 12,
    marginHorizontal: MOBILE_FILTER_INSET,
    borderRadius: 12,
    backgroundColor: '#fff',
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(60, 60, 67, 0.12)',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOpacity: 0.04,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 2 },
      },
      android: { elevation: 1 },
      default: {},
    }),
  },
  poMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    minHeight: 48,
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(60, 60, 67, 0.12)',
  },
  poMetaRowLast: {
    borderBottomWidth: 0,
  },
  poMetaLabel: {
    width: 92,
    flexShrink: 0,
    fontFamily: FONT,
    fontSize: 17,
    fontWeight: '400',
    letterSpacing: -0.41,
    color: MOBILE.label,
  },
  poMetaValue: {
    flex: 1,
    minWidth: 0,
    fontFamily: FONT,
    fontSize: 17,
    fontWeight: '400',
    letterSpacing: -0.41,
    color: MOBILE.secondary,
    textAlign: 'right',
  },
  poLineGroup: {
    marginTop: 4,
    marginHorizontal: MOBILE_FILTER_INSET,
    borderRadius: 12,
    backgroundColor: '#fff',
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(60, 60, 67, 0.12)',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOpacity: 0.04,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 2 },
      },
      android: { elevation: 1 },
      default: {},
    }),
  },
  poLineRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(60, 60, 67, 0.12)',
  },
  poLineRowLast: {
    borderBottomWidth: 0,
  },
  poLineThumbCell: {
    width: 44,
    flexShrink: 0,
    paddingTop: 1,
  },
  poLineBody: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  poLineTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  poLineName: {
    flex: 1,
    minWidth: 0,
    fontFamily: FONT,
    fontSize: 15,
    fontWeight: '500',
    lineHeight: 20,
    color: MOBILE.label,
    letterSpacing: -0.2,
  },
  poLineTotal: {
    flexShrink: 0,
    maxWidth: '42%',
    fontFamily: FONT,
    fontSize: 15,
    fontWeight: '600',
    lineHeight: 20,
    color: MOBILE.label,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  poLineMeta: {
    fontFamily: FONT,
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '400',
    color: MOBILE.secondary,
    letterSpacing: -0.08,
  },
  poTotalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    minHeight: 48,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(60, 60, 67, 0.18)',
    backgroundColor: 'rgba(0, 0, 0, 0.02)',
  },
  poTotalLabel: {
    fontFamily: FONT,
    fontSize: 17,
    fontWeight: '600',
    letterSpacing: -0.41,
    color: MOBILE.label,
  },
  poTotalValue: {
    fontFamily: FONT,
    fontSize: 17,
    fontWeight: '600',
    letterSpacing: -0.41,
    color: MOBILE.label,
    fontVariant: ['tabular-nums'],
  },
  feedSheet: {
    marginTop: 8,
    marginHorizontal: MOBILE_FILTER_INSET,
    padding: 16,
    backgroundColor: '#fff',
    borderRadius: 12,
    overflow: 'hidden',
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
    paddingHorizontal: MOBILE_FILTER_INSET,
    paddingTop: 10,
    backgroundColor: CANVAS,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(0,0,0,0.08)',
  },
  pageFooterWrap: {
    flexWrap: 'wrap',
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
  typeSearch: {
    minHeight: 44,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(60, 60, 67, 0.18)',
    fontFamily: FONT,
    fontSize: 17,
    color: '#000',
    ...Platform.select({
      web: { outlineStyle: 'none' },
      default: {},
    }),
  },
  typeEmpty: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontFamily: FONT,
    fontSize: 15,
    color: '#8E8E93',
  },
  typeAddRow: {
    gap: 8,
  },
  typeAddInput: {
    flex: 1,
    minHeight: 36,
    fontFamily: FONT,
    fontSize: 17,
    color: '#000',
    ...Platform.select({
      web: { outlineStyle: 'none' },
      default: {},
    }),
  },
  typeAddSave: {
    fontFamily: FONT,
    fontSize: 17,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  typeAddLink: {
    fontFamily: FONT,
    fontSize: 17,
    color: '#1a1a1a',
  },
  typeAddError: {
    paddingHorizontal: 16,
    paddingBottom: 10,
    fontFamily: FONT,
    fontSize: 13,
    color: '#FF3B30',
  },
  sectionLabel: {
    marginTop: 16,
    marginBottom: 6,
    marginLeft: 4,
    fontFamily: FONT,
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: -0.1,
    color: '#8E8E93',
    textTransform: 'uppercase',
  },
  poPhotos: {
    gap: 8,
    padding: 8,
    borderRadius: 12,
    backgroundColor: '#fff',
  },
  poPhoto: {
    width: '100%',
    height: 240,
    borderRadius: 8,
    backgroundColor: '#f5f5f5',
  },
  lineEdit: {
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(60, 60, 67, 0.18)',
  },
  lineEditAmounts: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  lineEditWas: {
    flex: 1,
    gap: 2,
  },
  lineEditNow: {
    flex: 1,
    gap: 2,
  },
  lineEditCaption: {
    fontFamily: FONT,
    fontSize: 12,
    fontWeight: '600',
    color: '#8E8E93',
    textTransform: 'uppercase',
  },
  lineEditInput: {
    minHeight: 36,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#f5f5f5',
    fontFamily: FONT,
    fontSize: 17,
    color: '#000',
    fontVariant: ['tabular-nums'],
    ...Platform.select({
      web: { outlineStyle: 'none' },
      default: {},
    }),
  },
  amountInput: {
    minHeight: 48,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: '#fff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(60, 60, 67, 0.18)',
    fontFamily: FONT,
    fontSize: 17,
    color: '#000',
    fontVariant: ['tabular-nums'],
    ...Platform.select({
      web: { outlineStyle: 'none' },
      default: {},
    }),
  },
  resultScroll: {
    maxHeight: 520,
  },
  errorFormGroup: {
    marginTop: 4,
  },
  errorPickerRow: {
    paddingRight: 12,
    gap: 6,
  },
  errorPickerValueHit: {
    flex: 1,
    minWidth: 0,
    alignItems: 'flex-end',
    justifyContent: 'center',
    minHeight: 28,
  },
  errorPickerValue: {
    fontFamily: FONT,
    fontSize: 17,
    fontWeight: '400',
    letterSpacing: -0.41,
    color: MOBILE.label,
    textAlign: 'right',
  },
  errorFieldPlaceholder: {
    color: MOBILE.secondary,
  },
  errorPhotoGroup: {
    marginTop: 16,
  },
  errorFieldBlock: {
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: 10,
    paddingTop: 16,
    paddingBottom: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(60, 60, 67, 0.12)',
  },
  errorFieldCaption: {
    fontFamily: FONT,
    fontSize: 13,
    fontWeight: '500',
    letterSpacing: -0.08,
    color: MOBILE.secondary,
    textTransform: 'uppercase',
  },
  errorAmountInput: {
    minHeight: 48,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: 'rgba(0, 0, 0, 0.04)',
    fontFamily: FONT,
    fontSize: 20,
    fontWeight: '500',
    letterSpacing: -0.41,
    color: MOBILE.label,
    fontVariant: ['tabular-nums'],
    ...Platform.select({
      web: { outlineStyle: 'none' },
      default: {},
    }),
  },
  errorDetailsInput: {
    minHeight: 96,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: 'rgba(0, 0, 0, 0.04)',
    fontFamily: FONT,
    fontSize: 17,
    lineHeight: 22,
    letterSpacing: -0.41,
    color: MOBILE.label,
    textAlignVertical: 'top',
    ...Platform.select({
      web: { outlineStyle: 'none' },
      default: {},
    }),
  },
  errorTypeSheet: {
    flex: 1,
    backgroundColor: CANVAS,
    paddingTop: Platform.OS === 'ios' ? 8 : 0,
  },
  errorTypeSheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: MOBILE_FILTER_INSET,
    paddingVertical: 12,
  },
  errorTypeSheetClose: {
    fontFamily: FONT,
    fontSize: 17,
    color: MOBILE.label,
  },
  errorTypeSheetTitle: {
    fontFamily: FONT,
    fontSize: 17,
    fontWeight: '600',
    color: MOBILE.label,
  },
  errorTypeSheetHeaderSpacer: {
    width: 56,
  },
  errorTypeSearchGroup: {
    marginTop: 0,
  },
  errorTypeSearch: {
    minHeight: 44,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontFamily: FONT,
    fontSize: 17,
    color: MOBILE.label,
    ...Platform.select({
      web: { outlineStyle: 'none' },
      default: {},
    }),
  },
  errorTypeSheetBody: {
    flex: 1,
  },
  errorTypeSheetScroll: {
    paddingBottom: 32,
    gap: 8,
  },
  errorTypeOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingRight: 12,
  },
  errorTypeOptionMain: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  errorTypeOptionLabel: {
    flex: 1,
    minWidth: 0,
    fontFamily: FONT,
    fontSize: 17,
    letterSpacing: -0.41,
    color: MOBILE.label,
  },
  errorTypeRemoveBtn: {
    padding: 4,
  },
  errorTypeEmpty: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontFamily: FONT,
    fontSize: 15,
    color: MOBILE.secondary,
  },
  errorTypeAddRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  errorTypeAddInput: {
    flex: 1,
    minWidth: 0,
    fontFamily: FONT,
    fontSize: 17,
    color: MOBILE.label,
    ...Platform.select({
      web: { outlineStyle: 'none' },
      default: {},
    }),
  },
  errorTypeAddSave: {
    fontFamily: FONT,
    fontSize: 17,
    fontWeight: '600',
    color: MOBILE.label,
  },
  errorTypeAddLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  errorTypeAddLinkText: {
    fontFamily: FONT,
    fontSize: 17,
    color: MOBILE.label,
  },
  errorTypeAddError: {
    marginHorizontal: MOBILE_FILTER_INSET,
    fontFamily: FONT,
    fontSize: 13,
    color: '#FF3B30',
  },
});
