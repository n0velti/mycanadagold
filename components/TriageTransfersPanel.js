import { createElement, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
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
import DateTimePicker from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { fetchTransferStores } from '../lib/locations';
import {
  collectRecordImageUrls,
  defaultDateRange,
  fetchTransactionDetail,
  fetchTransactions,
  formatDateParam,
  formatPickerDate,
  parseDateParam,
  parseDocReference,
  resolvePosAuthForRow,
  rowFromDocument,
} from '../lib/transactions';
import {
  RECEIVE_STATUS_LABELS,
  persistTransferWorkflowNow,
  plannedForTriageStore,
  updateTriageTransfers,
  useTransferWorkflow,
} from '../lib/transferWorkflow';
import { formatQty } from '../lib/transferPlan';
import { fetchTransfers } from '../lib/transfers';
import TriageReviewDrawer from './TriageReviewDrawer';

const fontFamily = Platform.select({
  ios: 'Sohne',
  android: 'Sohne',
  default: 'Sohne',
});

const ACCENT = '#C2410C';
const TEXT = '#1d1d1f';
const SECONDARY = '#8e8e93';
const FILL = '#e8e8ed';
const HAIRLINE = '#e5e5ea';
const GREEN = '#2F8A4E';

const STORE_TABS = [
  { key: 'melt', label: 'Melt', icon: 'flame-outline' },
  { key: 'bullion', label: 'Bullion', icon: 'diamond-outline' },
];

function newId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function fillMissingPoImages(token, baseUrl, rows) {
  const missing = rows.filter((row) => !(row.imageUrls || []).length);
  if (missing.length === 0) return rows;
  const updates = new Map();
  let cursor = 0;
  const workers = Math.min(4, missing.length);

  async function worker() {
    while (cursor < missing.length) {
      const index = cursor;
      cursor += 1;
      const row = missing[index];
      try {
        const detail = await fetchTransactionDetail(token, {
          type: 'purchase',
          sourceId: row.sourceId,
          baseUrl,
        });
        const imageUrls = collectRecordImageUrls(detail);
        if (imageUrls.length) updates.set(row.id, imageUrls);
      } catch {
        // Keep the row without a photo if detail lookup fails.
      }
    }
  }

  await Promise.all(Array.from({ length: workers }, () => worker()));
  if (updates.size === 0) return rows;
  return rows.map((row) => (updates.has(row.id) ? { ...row, imageUrls: updates.get(row.id) } : row));
}

function namesMatch(a, b) {
  return (
    String(a || '')
      .trim()
      .localeCompare(String(b || '').trim(), undefined, { sensitivity: 'base' }) === 0
  );
}

function matchesDocQuery(row, query) {
  const q = String(query || '').trim();
  if (!q) return true;
  if (!row) return false;
  const parsed = parseDocReference(q);
  const digits = q.replace(/[^\d]/g, '');
  if (parsed && String(row.sourceId) === parsed.sourceId) {
    if (parsed.type === 'purchase') return row.type === 'purchase';
    if (parsed.type === 'order') return row.type === 'order';
    return true;
  }
  if (digits && String(row.sourceId || '').includes(digits)) return true;
  const hay = [row.reference, row.sourceId, row.customerName, row.dateLabel]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return hay.includes(q.toLowerCase());
}

function DateField({ value, onChange, minimumDate, maximumDate }) {
  const [open, setOpen] = useState(false);
  const dateValue = parseDateParam(value);

  const commit = (next) => {
    if (!next) return;
    let date = parseDateParam(next);
    if (minimumDate && date < parseDateParam(minimumDate)) date = parseDateParam(minimumDate);
    if (maximumDate && date > parseDateParam(maximumDate)) date = parseDateParam(maximumDate);
    onChange(date);
  };

  if (Platform.OS === 'web') {
    return (
      <View style={styles.dateField}>
        <Ionicons name="calendar-outline" size={16} color={SECONDARY} />
        {createElement('input', {
          type: 'date',
          value: formatDateParam(dateValue),
          min: minimumDate ? formatDateParam(minimumDate) : undefined,
          max: maximumDate ? formatDateParam(maximumDate) : undefined,
          onChange: (event) => {
            if (event.target.value) commit(event.target.value);
          },
          style: {
            border: 'none',
            background: 'transparent',
            fontFamily,
            fontSize: 16,
            color: TEXT,
            padding: 0,
            margin: 0,
            outline: 'none',
            cursor: 'pointer',
            flex: 1,
            minWidth: 140,
          },
        })}
      </View>
    );
  }

  return (
    <>
      <Pressable style={styles.dateField} onPress={() => setOpen(true)}>
        <Ionicons name="calendar-outline" size={16} color={SECONDARY} />
        <Text style={styles.dateFieldValue}>{formatPickerDate(dateValue)}</Text>
      </Pressable>

      {Platform.OS === 'android' && open ? (
        <DateTimePicker
          value={dateValue}
          mode="date"
          display="default"
          minimumDate={minimumDate ? parseDateParam(minimumDate) : undefined}
          maximumDate={maximumDate ? parseDateParam(maximumDate) : undefined}
          onChange={(event, selected) => {
            setOpen(false);
            if (event.type !== 'dismissed' && selected) commit(selected);
          }}
        />
      ) : null}

      {Platform.OS === 'ios' ? (
        <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
          <View style={styles.modalBackdrop}>
            <Pressable style={StyleSheet.absoluteFill} onPress={() => setOpen(false)} />
            <View style={styles.dateModalCard}>
              <View style={styles.dateModalHeader}>
                <Text style={styles.modalTitle}>Date</Text>
                <Pressable onPress={() => setOpen(false)} hitSlop={8}>
                  <Text style={styles.doneText}>Done</Text>
                </Pressable>
              </View>
              <DateTimePicker
                value={dateValue}
                mode="date"
                display="spinner"
                minimumDate={minimumDate ? parseDateParam(minimumDate) : undefined}
                maximumDate={maximumDate ? parseDateParam(maximumDate) : undefined}
                onChange={(_, selected) => {
                  if (selected) commit(selected);
                }}
              />
            </View>
          </View>
        </Modal>
      ) : null}
    </>
  );
}

function EmptyState({ icon, title, body }) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}>
        <Ionicons name={icon} size={22} color={ACCENT} />
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyBody}>{body}</Text>
    </View>
  );
}

function ListRow({ title, meta, subtitle, subtitleLines = 1, onPress, accessibilityLabel }) {
  return (
    <Pressable
      style={styles.listRow}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || title}
      {...(Platform.OS === 'web' ? { className: 'cgold-triage-row' } : null)}
    >
      <View style={styles.listRowText}>
        <Text style={styles.listRowTitle} numberOfLines={1}>
          {title}
        </Text>
        {meta ? (
          <Text style={styles.listRowMeta} numberOfLines={1}>
            {meta}
          </Text>
        ) : null}
        {subtitle ? (
          <Text style={styles.listRowSub} numberOfLines={subtitleLines}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      <Ionicons name="chevron-forward" size={18} color={SECONDARY} />
    </Pressable>
  );
}

function PoThumb({ urls, label }) {
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const photos = Array.isArray(urls) ? urls.filter(Boolean) : [];

  useEffect(() => {
    setFailed(false);
  }, [photos[0]]);

  if (!photos.length || failed) {
    return (
      <View style={styles.poThumbSlot}>
        <Ionicons name="image-outline" size={16} color={SECONDARY} />
      </View>
    );
  }

  return (
    <>
      <Pressable
        onPress={(event) => {
          event?.stopPropagation?.();
          setOpen(true);
        }}
        style={styles.poThumbPress}
        accessibilityRole="button"
        accessibilityLabel={`View photo for ${label}`}
      >
        <Image
          source={{ uri: photos[0] }}
          style={styles.poThumb}
          resizeMode="cover"
          onError={() => setFailed(true)}
        />
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View style={styles.photoViewerRoot}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setOpen(false)} />
          <View style={styles.photoViewerSheet} pointerEvents="box-none">
            <View style={styles.photoViewerBar}>
              <Text style={styles.photoViewerTitle} numberOfLines={1}>
                {label}
              </Text>
              <Pressable onPress={() => setOpen(false)} hitSlop={8} accessibilityLabel="Close photo">
                <Ionicons name="close" size={20} color={TEXT} />
              </Pressable>
            </View>
            <Image source={{ uri: photos[0] }} style={styles.photoViewerImage} resizeMode="contain" />
          </View>
        </View>
      </Modal>
    </>
  );
}

function storeOnTransfer(row, store) {
  return (row?.stores || []).some(
    (entry) =>
      (store.storeKey && entry.storeKey === store.storeKey) || namesMatch(entry.name, store.name),
  );
}

function lastTriageTransferDate(transfers, store, currentDateKey) {
  const current = currentDateKey || formatDateParam(new Date());
  const prior = (transfers || [])
    .filter((row) => row.dateKey && row.dateKey < current && storeOnTransfer(row, store))
    .sort((a, b) => b.dateKey.localeCompare(a.dateKey));
  return prior[0]?.dateKey || null;
}

async function lastPosTransferDate(session, store) {
  const auth = resolvePosAuthForRow(session, { systemKey: store.systemKey });
  if (!auth.token) return null;
  const since = new Date();
  since.setFullYear(since.getFullYear() - 2);
  const sinceKey = formatDateParam(since);
  const lists = await Promise.all([
    fetchTransfers(auth.token, { status: 'received', since: sinceKey, baseUrl: auth.baseUrl }).catch(
      () => [],
    ),
    fetchTransfers(auth.token, { status: 'pending', since: sinceKey, baseUrl: auth.baseUrl }).catch(
      () => [],
    ),
  ]);
  const matches = lists
    .flat()
    .filter((row) => namesMatch(row?.from?.name, store.name) && row.date)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  return matches[0]?.date || null;
}

function DateRangeModal({
  visible,
  onClose,
  onConfirm,
  busy,
  error,
  session,
  store,
  transfers,
  currentDateKey,
}) {
  const [start, setStart] = useState(() => defaultDateRange(7).start);
  const [end, setEnd] = useState(() => defaultDateRange(7).end);
  const [lastBusy, setLastBusy] = useState(false);
  const [lastHint, setLastHint] = useState('');
  const [localError, setLocalError] = useState('');

  useEffect(() => {
    if (!visible) return;
    const next = defaultDateRange(7);
    setStart(next.start);
    setEnd(next.end);
    setLastHint('');
    setLastBusy(false);
    setLocalError('');
  }, [visible]);

  const confirm = (fromDate = start, toDate = end) => {
    let from = parseDateParam(fromDate);
    let to = parseDateParam(toDate);
    if (from > to) {
      const swap = from;
      from = to;
      to = swap;
    }
    onConfirm({ startDate: formatDateParam(from), endDate: formatDateParam(to) });
  };

  const fromLastTransfer = async () => {
    setLastBusy(true);
    setLocalError('');
    try {
      let startKey = lastTriageTransferDate(transfers, store, currentDateKey);
      if (!startKey) {
        startKey = await lastPosTransferDate(session, store);
      }
      if (!startKey) {
        setLastHint('');
        setLocalError('No previous transfer found for this store.');
        return;
      }
      const today = formatDateParam(new Date());
      setStart(parseDateParam(startKey));
      setEnd(parseDateParam(today));
      setLastHint(`Last transfer: ${formatPickerDate(startKey)}`);
      confirm(startKey, today);
    } catch (err) {
      setLocalError(err?.message || 'Could not find the last transfer for this store.');
    } finally {
      setLastBusy(false);
    }
  };

  const waiting = busy || lastBusy;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={waiting ? undefined : onClose} />
        <View style={styles.smallCard}>
          <Text style={styles.modalTitle}>Add purchases</Text>
          <Text style={styles.modalSub}>Choose the date range to load POs from this store.</Text>
          <View style={styles.rangeRow}>
            <View style={styles.rangeField}>
              <Text style={styles.rangeLabel}>Start</Text>
              <DateField value={start} onChange={setStart} maximumDate={end} />
            </View>
            <View style={styles.rangeField}>
              <Text style={styles.rangeLabel}>End</Text>
              <DateField value={end} onChange={setEnd} minimumDate={start} />
            </View>
          </View>
          {lastHint ? <Text style={styles.lastTransferHint}>{lastHint}</Text> : null}
          {localError || error ? <Text style={styles.errorText}>{localError || error}</Text> : null}
          <Pressable
            style={styles.lastTransferButton}
            onPress={fromLastTransfer}
            disabled={waiting}
            accessibilityRole="button"
            accessibilityLabel="From last transfer"
          >
            {lastBusy ? (
              <ActivityIndicator color={ACCENT} />
            ) : (
              <Text style={styles.lastTransferButtonText}>From last transfer</Text>
            )}
          </Pressable>
          <View style={styles.modalActions}>
            <Pressable style={styles.secondaryButton} onPress={onClose} disabled={waiting}>
              <Text style={styles.secondaryButtonText}>Cancel</Text>
            </Pressable>
            <Pressable
              style={[styles.primaryButton, styles.primaryButtonInline, waiting && styles.primaryButtonDisabled]}
              onPress={() => confirm()}
              disabled={waiting}
            >
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>Add</Text>}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function MeltPoRow({ row, onOpen, onToggleReceived, onRemove }) {
  const received = Boolean(row.received);
  const reviewed = Boolean(row.review);
  const reviewBits = [
    row.review?.corrections?.length
      ? `${row.review.corrections.length} correction${row.review.corrections.length === 1 ? '' : 's'}`
      : '',
    row.review?.note ? 'Note' : '',
    row.review?.images?.length
      ? `${row.review.images.length} photo${row.review.images.length === 1 ? '' : 's'}`
      : '',
  ].filter(Boolean);

  return (
    <Pressable
      style={styles.poRow}
      onPress={() => onOpen(row)}
      accessibilityRole="button"
      accessibilityLabel={`Open ${row.reference}`}
      {...(Platform.OS === 'web' ? { className: 'cgold-triage-row' } : null)}
    >
      <PoThumb urls={row.imageUrls} label={row.reference} />
      <View style={styles.poRowText}>
        <Text style={styles.poRef} numberOfLines={1}>
          {row.reference}
        </Text>
        <Text style={styles.poSub} numberOfLines={1}>
          {[row.dateLabel, row.customerName].filter(Boolean).join(' · ')}
        </Text>
        {reviewed ? (
          <Text style={styles.poReview} numberOfLines={1}>
            {reviewBits.join(' · ') || 'Reviewed'}
          </Text>
        ) : null}
      </View>
      <Pressable
        style={styles.receivedGroup}
        onPress={(event) => {
          event?.stopPropagation?.();
          onToggleReceived(row.id);
        }}
        accessibilityRole="button"
        accessibilityLabel={received ? `${row.reference} received` : `Mark ${row.reference} received`}
        accessibilityState={{ selected: received }}
      >
        <Ionicons
          name={received ? 'checkmark-circle' : 'checkmark-circle-outline'}
          size={22}
          color={received ? GREEN : '#c7c7cc'}
        />
        <View style={[styles.receivedButton, received && styles.receivedButtonOn]}>
          <Text style={[styles.receivedButtonText, received && styles.receivedButtonTextOn]}>Received</Text>
        </View>
      </Pressable>
      <Pressable
        style={styles.removePoButton}
        onPress={(event) => {
          event?.stopPropagation?.();
          onRemove(row.id);
        }}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={`Remove ${row.reference}`}
      >
        <Ionicons name="close-circle" size={22} color={SECONDARY} />
      </Pressable>
    </Pressable>
  );
}

function SpecificDocModal({ visible, store, auth, existingIds, onClose, onAdd }) {
  const [kind, setKind] = useState('PO');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [results, setResults] = useState([]);
  const searchGen = useRef(0);

  useEffect(() => {
    if (!visible) return;
    setKind('PO');
    setValue('');
    setBusy(false);
    setError('');
    setResults([]);
  }, [visible]);

  const runSearch = useCallback(
    async (raw, selectedKind) => {
      const query = String(raw || '').trim();
      if (!query) {
        setResults([]);
        setError('');
        return;
      }
      if (!auth?.token) {
        setError('Sign in to search documents.');
        setResults([]);
        return;
      }

      const gen = (searchGen.current += 1);
      setBusy(true);
      setError('');
      try {
        const system = {
          key: store.systemKey || 'east',
          label: store.systemLabel || 'Canada Gold East',
          baseUrl: auth.baseUrl,
        };
        const digits = query.replace(/[^\d]/g, '');
        const typed = parseDocReference(query);
        const candidates = [];
        if (typed) candidates.push(typed);
        else if (digits) {
          candidates.push(parseDocReference(`${selectedKind}# ${digits}`));
          const other = selectedKind === 'PO' ? 'SO' : 'PO';
          candidates.push(parseDocReference(`${other}# ${digits}`));
        }

        const found = [];
        const seen = new Set();
        let otherStore = '';

        for (const doc of candidates.filter(Boolean)) {
          try {
            const detail = await fetchTransactionDetail(auth.token, {
              type: doc.type,
              sourceId: doc.sourceId,
              baseUrl: auth.baseUrl,
            });
            const row = rowFromDocument(detail, doc.type, system);
            if (!row?.id || seen.has(row.id)) continue;
            if (!namesMatch(row.storeName, store.name)) {
              otherStore = row.storeName || 'another store';
              continue;
            }
            seen.add(row.id);
            found.push(row);
          } catch {
            // Try the next PO/SO candidate.
          }
        }

        if (gen !== searchGen.current) return;
        setResults(found);
        if (found.length === 0) {
          setError(
            otherStore
              ? `That document is for ${otherStore}, not ${store?.name || 'this store'}.`
              : `No matching PO or SO at ${store?.name || 'this store'}.`,
          );
        }
      } catch (err) {
        if (gen !== searchGen.current) return;
        setResults([]);
        setError(err?.message || 'Search failed.');
      } finally {
        if (gen === searchGen.current) setBusy(false);
      }
    },
    [auth, store.name, store.systemKey, store.systemLabel],
  );

  useEffect(() => {
    if (!visible) return;
    const query = value.trim();
    if (!query) {
      setResults([]);
      setError('');
      return undefined;
    }
    const timer = setTimeout(() => {
      runSearch(query, kind);
    }, 350);
    return () => clearTimeout(timer);
  }, [kind, runSearch, value, visible]);

  if (!visible) return null;

  const pick = (row) => {
    if ((existingIds || []).includes(row.id)) {
      setError(`${row.reference} is already on this list.`);
      return;
    }
    onAdd(row);
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={busy ? undefined : onClose} />
        <View style={styles.smallCard}>
          <Text style={styles.modalTitle}>Search PO / SO</Text>
          <Text style={styles.modalSub}>
            Search a document number from {store?.name || 'this store'}.
          </Text>
          <View style={styles.kindRow}>
            {['PO', 'SO'].map((option) => {
              const active = kind === option;
              return (
                <Pressable
                  key={option}
                  style={[styles.kindChip, active && styles.kindChipActive]}
                  onPress={() => setKind(option)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                >
                  <Text style={[styles.kindChipText, active && styles.kindChipTextActive]}>{option}</Text>
                </Pressable>
              );
            })}
          </View>
          <View style={styles.searchField}>
            <Ionicons name="search" size={16} color={SECONDARY} style={styles.searchIcon} />
            <TextInput
              style={styles.searchInput}
              value={value}
              onChangeText={setValue}
              placeholder={`${kind}# 12345`}
              placeholderTextColor={SECONDARY}
              autoCapitalize="characters"
              autoCorrect={false}
              keyboardType="default"
              onSubmitEditing={() => runSearch(value, kind)}
            />
            {value ? (
              <Pressable
                onPress={() => {
                  setValue('');
                  setResults([]);
                  setError('');
                }}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Clear search"
              >
                <Ionicons name="close-circle" size={18} color="#c7c7cc" />
              </Pressable>
            ) : null}
          </View>
          {busy ? (
            <View style={styles.modalBusy}>
              <ActivityIndicator color={ACCENT} />
            </View>
          ) : null}
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
          {results.length > 0 ? (
            <ScrollView
              style={styles.docResultList}
              contentContainerStyle={styles.docResultListContent}
              keyboardShouldPersistTaps="handled"
              nestedScrollEnabled
            >
              {results.map((row) => {
                const already = (existingIds || []).includes(row.id);
                return (
                  <Pressable
                    key={row.id}
                    style={styles.docResultRow}
                    onPress={() => pick(row)}
                    accessibilityRole="button"
                    accessibilityLabel={`Add ${row.reference}`}
                  >
                    <View style={styles.poRowText}>
                      <Text style={styles.poRef} numberOfLines={1}>
                        {row.reference}
                      </Text>
                      <Text style={styles.poSub} numberOfLines={1}>
                        {[row.dateLabel, row.customerName].filter(Boolean).join(' · ')}
                      </Text>
                    </View>
                    <Text style={[styles.docResultAction, already && styles.docResultActionMuted]}>
                      {already ? 'Added' : 'Add'}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          ) : null}
          <View style={styles.modalActions}>
            <Pressable style={styles.secondaryButton} onPress={onClose} disabled={busy}>
              <Text style={styles.secondaryButtonText}>Cancel</Text>
            </Pressable>
            <Pressable
              style={[styles.primaryButton, styles.primaryButtonInline, busy && styles.primaryButtonDisabled]}
              onPress={() => runSearch(value, kind)}
              disabled={busy}
            >
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>Search</Text>}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function MeltTab({
  session,
  store,
  dateKey,
  pos,
  addOpen,
  onAddOpenChange,
  specificOpen,
  onSpecificOpenChange,
  onMergePos,
  onRemovePos,
  onToggleReceived,
  onSaveReview,
}) {
  const { triage } = useTransferWorkflow();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [openRow, setOpenRow] = useState(null);
  const [docQuery, setDocQuery] = useState('');
  const auth = useMemo(
    () => resolvePosAuthForRow(session, { systemKey: store.systemKey }),
    [session, store.systemKey],
  );
  const existingIds = useMemo(() => (pos || []).map((row) => row.id), [pos]);
  const visiblePos = useMemo(
    () => (pos || []).filter((row) => matchesDocQuery(row, docQuery)),
    [docQuery, pos],
  );

  const loadRange = useCallback(
    async ({ startDate, endDate }) => {
      if (!startDate || !endDate) return;
      if (!auth.token) {
        setError('Sign in to load purchases.');
        return;
      }
      setBusy(true);
      setError('');
      try {
        const system = {
          key: store.systemKey || 'east',
          label: store.systemLabel || 'Canada Gold East',
          baseUrl: auth.baseUrl,
        };
        const result = await fetchTransactions(auth.token, {
          startDate,
          endDate,
          baseUrl: auth.baseUrl,
          includePurchases: true,
          includeOrders: false,
          system,
        });
        const next = result.rows.filter(
          (row) => row.type === 'purchase' && namesMatch(row.storeName, store.name),
        );
        if (next.length === 0) {
          setError('No purchases in that range for this store.');
          return;
        }
        onMergePos(next);
        onAddOpenChange(false);
        fillMissingPoImages(auth.token, auth.baseUrl, next)
          .then((enriched) => {
            if (enriched !== next) onMergePos(enriched);
          })
          .catch(() => {});
      } catch (err) {
        setError(err?.message || 'Failed to load purchases.');
      } finally {
        setBusy(false);
      }
    },
    [auth, onAddOpenChange, onMergePos, store.name, store.systemKey, store.systemLabel],
  );

  return (
    <View style={styles.body}>
      <View style={[styles.searchField, styles.meltSearchField]}>
        <Ionicons name="search" size={16} color={SECONDARY} style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          value={docQuery}
          onChangeText={setDocQuery}
          placeholder="Search PO# or SO#"
          placeholderTextColor={SECONDARY}
          autoCapitalize="characters"
          autoCorrect={false}
          clearButtonMode="while-editing"
        />
        {docQuery ? (
          <Pressable onPress={() => setDocQuery('')} hitSlop={8} accessibilityRole="button">
            <Ionicons name="close-circle" size={18} color="#c7c7cc" />
          </Pressable>
        ) : null}
      </View>

      {pos.length === 0 ? (
        <EmptyState
          icon="flame-outline"
          title="Melt"
          body="Tap Add for a date range, or PO / SO to search and add a document from this store."
        />
      ) : visiblePos.length === 0 ? (
        <EmptyState
          icon="search-outline"
          title="No matches"
          body={`No PO or SO on this list matches “${docQuery.trim()}”.`}
        />
      ) : (
        <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
          {visiblePos.map((row) => (
            <MeltPoRow
              key={row.id}
              row={row}
              onOpen={setOpenRow}
              onToggleReceived={onToggleReceived}
              onRemove={(id) => {
                if (openRow?.id === id) setOpenRow(null);
                onRemovePos(id);
              }}
            />
          ))}
        </ScrollView>
      )}

      <SpecificDocModal
        visible={specificOpen}
        store={store}
        auth={auth}
        existingIds={existingIds}
        onClose={() => onSpecificOpenChange(false)}
        onAdd={(row) => {
          onMergePos([row]);
          onSpecificOpenChange(false);
          if (row.type === 'purchase' && auth.token) {
            fillMissingPoImages(auth.token, auth.baseUrl, [row])
              .then((enriched) => {
                if (enriched[0] && enriched[0] !== row) onMergePos(enriched);
              })
              .catch(() => {});
          }
        }}
      />

      <DateRangeModal
        visible={addOpen}
        busy={busy}
        error={error}
        session={session}
        store={store}
        transfers={triage}
        currentDateKey={dateKey}
        onClose={() => {
          if (!busy) {
            setError('');
            onAddOpenChange(false);
          }
        }}
        onConfirm={loadRange}
      />

      <TriageReviewDrawer
        visible={Boolean(openRow)}
        session={session}
        row={openRow}
        review={openRow?.review || null}
        extraRows={pos}
        onClose={() => setOpenRow(null)}
        onSave={onSaveReview}
      />
    </View>
  );
}

function BullionTab({ dateKey, store }) {
  const { planned } = useTransferWorkflow();
  const rows = useMemo(
    () =>
      (planned || []).filter(
        (row) =>
          row.forTriage &&
          row.dateKey === dateKey &&
          row.fromStoreKey === store?.storeKey,
      ),
    [dateKey, planned, store?.storeKey],
  );
  const [openId, setOpenId] = useState(null);

  if (rows.length === 0) {
    return (
      <EmptyState
        icon="diamond-outline"
        title="Bullion"
        body={`Bullion transfers from ${store?.name || 'this store'} created in Transfer setup will appear here.`}
      />
    );
  }

  return (
    <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
      {rows.map((row) => {
        const open = openId === row.id;
        return (
          <View key={row.id} style={styles.bullionCard}>
            <Pressable
              style={styles.bullionHeader}
              onPress={() => setOpenId(open ? null : row.id)}
              accessibilityRole="button"
              accessibilityLabel={`${row.reference} ${row.dateLabel}`}
            >
              <View style={styles.listRowText}>
                <Text style={styles.listRowTitle} numberOfLines={1}>
                  {row.reference}
                </Text>
                <Text style={styles.listRowSub} numberOfLines={1}>
                  {row.dateLabel}
                  {row.pathLabels?.length ? ` · ${row.pathLabels.join(' → ')}` : ''}
                </Text>
              </View>
              <View style={styles.bullionStatus}>
                <Text style={styles.bullionStatusText}>
                  {RECEIVE_STATUS_LABELS[row.receiveStatus] || 'Not Received'}
                </Text>
                <Ionicons
                  name={open ? 'chevron-up' : 'chevron-down'}
                  size={16}
                  color={SECONDARY}
                />
              </View>
            </Pressable>
            {row.note ? (
              <Text style={styles.bullionNote} numberOfLines={open ? 0 : 1}>
                {row.note}
              </Text>
            ) : null}
            {open ? (
              <View style={styles.bullionItems}>
                {(row.items || []).map((item) => (
                  <View key={item.id} style={styles.bullionItemRow}>
                    <View style={styles.listRowText}>
                      <Text style={styles.bullionItemName} numberOfLines={2}>
                        {item.productName}
                      </Text>
                      <Text style={styles.listRowSub} numberOfLines={1}>
                        {item.fromName} → {item.toName}
                      </Text>
                    </View>
                    <Text style={styles.bullionItemQty}>{formatQty(item.sentQty)}</Text>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        );
      })}
    </ScrollView>
  );
}

function mapPickedStore(store) {
  return {
    id: newId('store'),
    storeKey: store.id,
    name: store.name,
    systemKey: store.systemKey,
    systemLabel: store.systemLabel,
    sourceId: store.sourceId,
    city: store.city || '',
    meltPos: [],
  };
}

function StoreMultiPicker({ session, addedKeys, selectedIds, onChangeSelected }) {
  const [query, setQuery] = useState('');
  const [stores, setStores] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const storesRef = useRef(stores);
  storesRef.current = stores;

  useEffect(() => {
    let cancelled = false;
    setQuery('');
    setError('');
    setLoading(true);

    fetchTransferStores(session)
      .then((result) => {
        if (cancelled) return;
        setStores(result.stores || []);
        if (result.warning) setError(result.warning);
      })
      .catch((err) => {
        if (cancelled) return;
        setStores([]);
        setError(err?.message || 'Failed to load stores.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [session]);

  const emit = (nextIds) => {
    const picked = storesRef.current.filter((store) => nextIds.has(store.id));
    onChangeSelected(nextIds, picked);
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return stores.filter((store) => {
      if (addedKeys.has(store.id)) return false;
      if (!q) return true;
      const hay = [store.name, store.city, store.systemLabel, store.address]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [addedKeys, query, stores]);

  const allVisibleSelected = filtered.length > 0 && filtered.every((store) => selectedIds.has(store.id));

  const toggle = (storeId) => {
    const next = new Set(selectedIds);
    if (next.has(storeId)) next.delete(storeId);
    else next.add(storeId);
    emit(next);
  };

  const toggleVisible = () => {
    const next = new Set(selectedIds);
    if (allVisibleSelected) {
      filtered.forEach((store) => next.delete(store.id));
    } else {
      filtered.forEach((store) => next.add(store.id));
    }
    emit(next);
  };

  return (
    <View style={styles.storePicker}>
      <View style={styles.searchField}>
        <Ionicons name="search" size={16} color={SECONDARY} style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          value={query}
          onChangeText={setQuery}
          placeholder="Search stores"
          placeholderTextColor={SECONDARY}
          autoCorrect={false}
          autoCapitalize="none"
          clearButtonMode="while-editing"
        />
      </View>

      <View style={styles.storeSelectBar}>
        <Text style={styles.storeSelectCount}>
          {selectedIds.size === 0
            ? 'Select stores'
            : `${selectedIds.size} selected`}
        </Text>
        {filtered.length > 0 ? (
          <Pressable onPress={toggleVisible} hitSlop={8} accessibilityRole="button">
            <Text style={styles.storeSelectAll}>{allVisibleSelected ? 'Clear visible' : 'Select visible'}</Text>
          </Pressable>
        ) : null}
      </View>

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      {loading ? (
        <View style={styles.modalBusy}>
          <ActivityIndicator color={ACCENT} />
        </View>
      ) : (
        <ScrollView
          style={styles.storeList}
          contentContainerStyle={styles.storeListContent}
          keyboardShouldPersistTaps="handled"
          nestedScrollEnabled
          showsVerticalScrollIndicator
        >
          {filtered.length === 0 ? (
            <Text style={styles.modalEmpty}>
              {stores.length === 0 ? 'No stores available.' : 'No matching stores.'}
            </Text>
          ) : (
            filtered.map((store) => {
              const selected = selectedIds.has(store.id);
              return (
                <Pressable
                  key={store.id}
                  style={[styles.storePickRow, selected && styles.storePickRowSelected]}
                  onPress={() => toggle(store.id)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: selected }}
                  accessibilityLabel={store.name}
                >
                  <Ionicons
                    name={selected ? 'checkbox' : 'square-outline'}
                    size={22}
                    color={selected ? ACCENT : '#c7c7cc'}
                  />
                  <View style={styles.listRowText}>
                    <Text style={styles.listRowTitle} numberOfLines={1}>
                      {store.name}
                    </Text>
                    <Text style={styles.listRowSub} numberOfLines={1}>
                      {[store.city, store.systemLabel].filter(Boolean).join(' · ') || store.address}
                    </Text>
                  </View>
                </Pressable>
              );
            })
          )}
        </ScrollView>
      )}
    </View>
  );
}

function LocationPicker({ session, selectedId, onSelect }) {
  const [query, setQuery] = useState('');
  const [stores, setStores] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setQuery('');
    setError('');
    setLoading(true);
    fetchTransferStores(session)
      .then((result) => {
        if (cancelled) return;
        setStores(result.stores || []);
        if (result.warning) setError(result.warning);
      })
      .catch((err) => {
        if (cancelled) return;
        setStores([]);
        setError(err?.message || 'Failed to load locations.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [session]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return stores;
    return stores.filter((store) => {
      const hay = [store.name, store.city, store.systemLabel, store.address]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [query, stores]);

  return (
    <View style={styles.storePicker}>
      <View style={styles.searchField}>
        <Ionicons name="search" size={16} color={SECONDARY} style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          value={query}
          onChangeText={setQuery}
          placeholder="Search locations"
          placeholderTextColor={SECONDARY}
          autoCorrect={false}
          autoCapitalize="none"
          clearButtonMode="while-editing"
        />
      </View>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      {loading ? (
        <View style={styles.modalBusy}>
          <ActivityIndicator color={ACCENT} />
        </View>
      ) : (
        <ScrollView
          style={styles.storeList}
          contentContainerStyle={styles.storeListContent}
          keyboardShouldPersistTaps="handled"
          nestedScrollEnabled
          showsVerticalScrollIndicator
        >
          {filtered.length === 0 ? (
            <Text style={styles.modalEmpty}>
              {stores.length === 0 ? 'No locations available.' : 'No matching locations.'}
            </Text>
          ) : (
            filtered.map((store) => {
              const selected = selectedId === store.id;
              return (
                <Pressable
                  key={store.id}
                  style={[styles.storePickRow, selected && styles.storePickRowSelected]}
                  onPress={() => onSelect(store)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  accessibilityLabel={store.name}
                >
                  <Ionicons
                    name={selected ? 'radio-button-on' : 'radio-button-off'}
                    size={22}
                    color={selected ? ACCENT : '#c7c7cc'}
                  />
                  <View style={styles.listRowText}>
                    <Text style={styles.listRowTitle} numberOfLines={1}>
                      {store.name}
                    </Text>
                    <Text style={styles.listRowSub} numberOfLines={1}>
                      {[store.city, store.systemLabel].filter(Boolean).join(' · ') || store.address}
                    </Text>
                  </View>
                </Pressable>
              );
            })
          )}
        </ScrollView>
      )}
    </View>
  );
}

function CreateTransferModal({ visible, session, existingKeys, onClose, onCreate }) {
  const [step, setStep] = useState('stores');
  const [date, setDate] = useState(() => parseDateParam(new Date()));
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [pickedStores, setPickedStores] = useState([]);
  const [location, setLocation] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!visible) return;
    setStep('stores');
    setDate(parseDateParam(new Date()));
    setSelectedIds(new Set());
    setPickedStores([]);
    setLocation(null);
    setError('');
  }, [visible]);

  const goNext = () => {
    const key = formatDateParam(date);
    if (existingKeys.has(key)) {
      setError('A transfer for this date already exists.');
      return;
    }
    if (pickedStores.length === 0) {
      setError('Select at least one store.');
      return;
    }
    setError('');
    setStep('location');
  };

  const create = () => {
    if (!location) {
      setError('Select where triage is taking place.');
      return;
    }
    onCreate({
      id: newId('xfer'),
      dateKey: formatDateParam(date),
      dateLabel: formatPickerDate(date),
      triageLocation: {
        storeKey: location.id,
        name: location.name,
        systemKey: location.systemKey,
        systemLabel: location.systemLabel,
        city: location.city || '',
      },
      stores: pickedStores
        .map(mapPickedStore)
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })),
    });
  };

  if (!visible) return null;

  const onStores = step === 'stores';

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalBackdrop} pointerEvents="box-none">
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.storeCard} pointerEvents="auto">
          <View style={styles.storeHeader}>
            <View style={styles.storeTitleBlock}>
              {onStores ? null : (
                <Pressable onPress={() => setStep('stores')} style={styles.backButton} hitSlop={8}>
                  <Ionicons name="chevron-back" size={18} color={ACCENT} />
                  <Text style={styles.backText}>Stores</Text>
                </Pressable>
              )}
              <Text style={styles.modalTitle}>{onStores ? 'New transfer' : 'Triage location'}</Text>
              <Text style={styles.modalSub}>
                {onStores
                  ? 'Pick a date, then select one or more stores.'
                  : `Select where triage is taking place on ${formatPickerDate(date)}.`}
              </Text>
            </View>
            <Pressable onPress={onClose} hitSlop={8} accessibilityLabel="Close">
              <Ionicons name="close" size={22} color={SECONDARY} />
            </Pressable>
          </View>
          {onStores ? <DateField value={date} onChange={setDate} /> : null}
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
          {onStores ? (
            <StoreMultiPicker
              session={session}
              addedKeys={new Set()}
              selectedIds={selectedIds}
              onChangeSelected={(ids, picked) => {
                setSelectedIds(ids);
                setPickedStores(picked);
                if (error) setError('');
              }}
            />
          ) : (
            <LocationPicker session={session} selectedId={location?.id} onSelect={setLocation} />
          )}
          <View style={styles.modalActions}>
            <Pressable
              style={styles.secondaryButton}
              onPress={onStores ? onClose : () => setStep('stores')}
            >
              <Text style={styles.secondaryButtonText}>{onStores ? 'Cancel' : 'Back'}</Text>
            </Pressable>
            <Pressable
              style={[
                styles.primaryButton,
                styles.primaryButtonInline,
                (onStores ? pickedStores.length === 0 : !location) && styles.primaryButtonDisabled,
              ]}
              onPress={onStores ? goNext : create}
              disabled={onStores ? pickedStores.length === 0 : !location}
            >
              <Text style={styles.primaryButtonText}>{onStores ? 'Next' : 'Create'}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function AddStoreModal({ visible, session, addedKeys, onClose, onAdd }) {
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [pickedStores, setPickedStores] = useState([]);

  useEffect(() => {
    if (!visible) return;
    setSelectedIds(new Set());
    setPickedStores([]);
  }, [visible]);

  const add = () => {
    if (pickedStores.length === 0) return;
    onAdd(pickedStores.map(mapPickedStore));
  };

  if (!visible) return null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalBackdrop} pointerEvents="box-none">
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.storeCard} pointerEvents="auto">
          <View style={styles.storeHeader}>
            <View style={styles.storeTitleBlock}>
              <Text style={styles.modalTitle}>Add stores</Text>
              <Text style={styles.modalSub}>Select one or more stores to add to this transfer.</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={8} accessibilityLabel="Close">
              <Ionicons name="close" size={22} color={SECONDARY} />
            </Pressable>
          </View>
          <StoreMultiPicker
            session={session}
            addedKeys={addedKeys}
            selectedIds={selectedIds}
            onChangeSelected={(ids, picked) => {
              setSelectedIds(ids);
              setPickedStores(picked);
            }}
          />
          <View style={styles.modalActions}>
            <Pressable style={styles.secondaryButton} onPress={onClose}>
              <Text style={styles.secondaryButtonText}>Cancel</Text>
            </Pressable>
            <Pressable
              style={[
                styles.primaryButton,
                styles.primaryButtonInline,
                selectedIds.size === 0 && styles.primaryButtonDisabled,
              ]}
              onPress={add}
              disabled={selectedIds.size === 0}
            >
              <Text style={styles.primaryButtonText}>
                {selectedIds.size > 0 ? `Add ${selectedIds.size}` : 'Add'}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

export default function TriageTransfersPanel({
  session,
  onRequireLogin,
  createOpen,
  onCreateOpenChange,
  addStoreOpen,
  onAddStoreOpenChange,
  onViewChange,
}) {
  const { triage: transfers } = useTransferWorkflow();
  const [selectedId, setSelectedId] = useState(null);
  const [selectedStoreId, setSelectedStoreId] = useState(null);
  const [storeTab, setStoreTab] = useState('melt');
  const [addMeltOpen, setAddMeltOpen] = useState(false);
  const [specificOpen, setSpecificOpen] = useState(false);
  const [meltSaved, setMeltSaved] = useState(false);

  const selected = useMemo(
    () => transfers.find((row) => row.id === selectedId) || null,
    [selectedId, transfers],
  );
  const selectedStore = useMemo(
    () => selected?.stores.find((row) => row.id === selectedStoreId) || null,
    [selected, selectedStoreId],
  );

  const view = selectedStore ? 'store' : selected ? 'date' : 'list';

  useEffect(() => {
    onViewChange?.(view);
  }, [onViewChange, view]);

  const existingKeys = useMemo(() => new Set(transfers.map((row) => row.dateKey)), [transfers]);
  const addedKeys = useMemo(
    () => new Set((selected?.stores || []).map((row) => row.storeKey)),
    [selected],
  );

  const openTransfer = useCallback((row) => {
    setSelectedId(row.id);
    setSelectedStoreId(null);
    setStoreTab('melt');
  }, []);

  const createTransfer = useCallback(
    (row) => {
      updateTriageTransfers((current) =>
        [row, ...current].sort((a, b) => b.dateKey.localeCompare(a.dateKey)),
      );
      onCreateOpenChange(false);
    },
    [onCreateOpenChange],
  );

  const addStores = useCallback(
    (nextStores) => {
      if (!selectedId || !nextStores?.length) return;
      updateTriageTransfers((current) =>
        current.map((row) => {
          if (row.id !== selectedId) return row;
          const existing = new Set(row.stores.map((entry) => entry.storeKey));
          const added = nextStores
            .filter((store) => !existing.has(store.storeKey))
            .map((store) => ({ ...store, meltPos: store.meltPos || [] }));
          if (added.length === 0) return row;
          return {
            ...row,
            stores: [...row.stores, ...added].sort((a, b) =>
              a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
            ),
          };
        }),
      );
      onAddStoreOpenChange(false);
    },
    [onAddStoreOpenChange, selectedId],
  );

  const mergeMeltPos = useCallback(
    (nextRows) => {
      if (!selectedId || !selectedStoreId) return;
      updateTriageTransfers((current) =>
        current.map((row) => {
          if (row.id !== selectedId) return row;
          return {
            ...row,
            stores: row.stores.map((store) => {
              if (store.id !== selectedStoreId) return store;
              const existing = new Map((store.meltPos || []).map((item) => [item.id, item]));
              const merged = [...(store.meltPos || [])];
              for (const item of nextRows) {
                const prev = existing.get(item.id);
                if (prev) {
                  const imageUrls =
                    (prev.imageUrls || []).length > 0 ? prev.imageUrls : item.imageUrls || [];
                  if (imageUrls !== prev.imageUrls) {
                    const index = merged.findIndex((entry) => entry.id === item.id);
                    if (index >= 0) merged[index] = { ...prev, imageUrls };
                  }
                  continue;
                }
                merged.push({ ...item, received: false });
              }
              merged.sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0));
              return { ...store, meltPos: merged };
            }),
          };
        }),
      );
    },
    [selectedId, selectedStoreId],
  );

  const saveMeltReview = useCallback(
    (poId, review) => {
      if (!selectedId || !selectedStoreId) return;
      setMeltSaved(false);
      updateTriageTransfers((current) =>
        current.map((row) => {
          if (row.id !== selectedId) return row;
          return {
            ...row,
            stores: row.stores.map((store) => {
              if (store.id !== selectedStoreId) return store;
              return {
                ...store,
                meltPos: (store.meltPos || []).map((item) =>
                  item.id === poId ? { ...item, review } : item,
                ),
              };
            }),
          };
        }),
      );
    },
    [selectedId, selectedStoreId],
  );

  const removeMeltPo = useCallback(
    (poId) => {
      if (!selectedId || !selectedStoreId) return;
      setMeltSaved(false);
      updateTriageTransfers((current) =>
        current.map((row) => {
          if (row.id !== selectedId) return row;
          return {
            ...row,
            stores: row.stores.map((store) => {
              if (store.id !== selectedStoreId) return store;
              return {
                ...store,
                meltPos: (store.meltPos || []).filter((item) => item.id !== poId),
              };
            }),
          };
        }),
      );
    },
    [selectedId, selectedStoreId],
  );

  const saveMeltList = useCallback(async () => {
    try {
      await persistTransferWorkflowNow();
      setMeltSaved(true);
    } catch {
      setMeltSaved(false);
    }
  }, []);

  const toggleMeltReceived = useCallback(
    (poId) => {
      if (!selectedId || !selectedStoreId) return;
      setMeltSaved(false);
      updateTriageTransfers((current) =>
        current.map((row) => {
          if (row.id !== selectedId) return row;
          return {
            ...row,
            stores: row.stores.map((store) => {
              if (store.id !== selectedStoreId) return store;
              return {
                ...store,
                meltPos: (store.meltPos || []).map((item) =>
                  item.id === poId ? { ...item, received: !item.received } : item,
                ),
              };
            }),
          };
        }),
      );
    },
    [selectedId, selectedStoreId],
  );

  if (!session?.token) {
    return (
      <View style={styles.body}>
        <View style={styles.empty}>
          <View style={styles.emptyIcon}>
            <Ionicons name="swap-horizontal-outline" size={22} color={ACCENT} />
          </View>
          <Text style={styles.emptyTitle}>Transfers</Text>
          <Text style={styles.emptyBody}>Log in to create transfers and add stores.</Text>
          <Pressable style={styles.loginButton} onPress={onRequireLogin}>
            <Text style={styles.loginButtonText}>Go to Profile</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (selectedStore && selected) {
    return (
      <View style={styles.body}>
        <View style={styles.subHeader}>
          <Pressable
            style={styles.backButton}
            onPress={() => {
              setAddMeltOpen(false);
              setSpecificOpen(false);
              setMeltSaved(false);
              setSelectedStoreId(null);
            }}
            accessibilityRole="button"
            accessibilityLabel="Back to stores"
          >
            <Ionicons name="chevron-back" size={18} color={ACCENT} />
            <Text style={styles.backText}>{selected.dateLabel}</Text>
          </Pressable>
          <Text style={styles.pageTitle} numberOfLines={1}>
            {selectedStore.name}
          </Text>
        </View>

        <View style={styles.tabBar} accessibilityRole="tablist">
          <View style={styles.tabBarTabs}>
            {STORE_TABS.map((tab) => {
              const active = tab.key === storeTab;
              return (
                <Pressable
                  key={tab.key}
                  style={[styles.tab, active && styles.tabActive]}
                  onPress={() => {
                    setStoreTab(tab.key);
                    if (tab.key !== 'melt') {
                      setAddMeltOpen(false);
                      setSpecificOpen(false);
                    }
                  }}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={tab.label}
                >
                  <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{tab.label}</Text>
                </Pressable>
              );
            })}
          </View>
          {storeTab === 'melt' ? (
            <View style={styles.tabBarTrailing}>
              <Pressable
                style={[styles.saveButton, meltSaved && styles.saveButtonOn]}
                onPress={saveMeltList}
                accessibilityRole="button"
                accessibilityLabel="Save"
              >
                <Text style={[styles.saveButtonText, meltSaved && styles.saveButtonTextOn]}>
                  {meltSaved ? 'Saved' : 'Save'}
                </Text>
              </Pressable>
              <Pressable
                style={styles.ghostButton}
                onPress={() => setSpecificOpen(true)}
                accessibilityRole="button"
                accessibilityLabel="Add PO or SO"
              >
                <Text style={styles.ghostButtonText}>PO / SO</Text>
              </Pressable>
              <Pressable
                style={styles.newButton}
                onPress={() => setAddMeltOpen(true)}
                accessibilityRole="button"
                accessibilityLabel="Add"
              >
                <Ionicons name="add" size={18} color="#fff" />
                <Text style={styles.newButtonText}>Add</Text>
              </Pressable>
            </View>
          ) : null}
        </View>

        {storeTab === 'melt' ? (
          <MeltTab
            session={session}
            store={selectedStore}
            dateKey={selected.dateKey}
            pos={selectedStore.meltPos || []}
            addOpen={addMeltOpen}
            onAddOpenChange={setAddMeltOpen}
            specificOpen={specificOpen}
            onSpecificOpenChange={setSpecificOpen}
            onMergePos={(rows) => {
              setMeltSaved(false);
              mergeMeltPos(rows);
            }}
            onRemovePos={removeMeltPo}
            onToggleReceived={toggleMeltReceived}
            onSaveReview={saveMeltReview}
          />
        ) : (
          <BullionTab dateKey={selected.dateKey} store={selectedStore} />
        )}
      </View>
    );
  }

  if (selected) {
    return (
      <View style={styles.body}>
        <View style={styles.subHeader}>
          <Pressable
            style={styles.backButton}
            onPress={() => setSelectedId(null)}
            accessibilityRole="button"
            accessibilityLabel="Back to transfers"
          >
            <Ionicons name="chevron-back" size={18} color={ACCENT} />
            <Text style={styles.backText}>Transfers</Text>
          </Pressable>
          <Text style={styles.pageTitle} numberOfLines={1}>
            {selected.dateLabel}
          </Text>
          {selected.triageLocation?.name ? (
            <Text style={styles.pageMeta} numberOfLines={1}>
              Triage at {selected.triageLocation.name}
            </Text>
          ) : null}
        </View>

        {selected.stores.length === 0 ? (
          <EmptyState
            icon="storefront-outline"
            title={selected.dateLabel}
            body="Tap Add Store to include a store on this transfer."
          />
        ) : (
          <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
            {selected.stores.map((store) => (
              <ListRow
                key={store.id}
                title={store.name}
                subtitle={[store.city, store.systemLabel].filter(Boolean).join(' · ')}
                onPress={() => {
                  setSelectedStoreId(store.id);
                  const hasBullion =
                    plannedForTriageStore(selected.dateKey, store.storeKey).length > 0;
                  const hasMelt = (store.meltPos || []).length > 0;
                  setStoreTab(hasBullion && !hasMelt ? 'bullion' : 'melt');
                }}
                accessibilityLabel={`Open ${store.name}`}
              />
            ))}
          </ScrollView>
        )}

        <AddStoreModal
          visible={addStoreOpen}
          session={session}
          addedKeys={addedKeys}
          onClose={() => onAddStoreOpenChange(false)}
          onAdd={addStores}
        />
      </View>
    );
  }

  return (
    <View style={styles.body}>
      {transfers.length === 0 ? (
        <EmptyState
          icon="swap-horizontal-outline"
          title="Transfers"
          body="Tap New to create a transfer for a date."
        />
      ) : (
        <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
          {transfers.map((row) => (
            <ListRow
              key={row.id}
              title={row.dateLabel}
              meta={row.triageLocation?.name ? `Triage at ${row.triageLocation.name}` : ''}
              subtitle={
                row.stores.length
                  ? row.stores.map((store) => store.name).join('\n')
                  : 'No stores yet'
              }
              subtitleLines={row.stores.length || 1}
              onPress={() => openTransfer(row)}
              accessibilityLabel={`Open transfer ${row.dateLabel}`}
            />
          ))}
        </ScrollView>
      )}

      <CreateTransferModal
        visible={createOpen}
        session={session}
        existingKeys={existingKeys}
        onClose={() => onCreateOpenChange(false)}
        onCreate={createTransfer}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
    minHeight: 0,
  },
  empty: {
    flex: 1,
    minHeight: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingBottom: 48,
  },
  emptyIcon: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: '#FFEDD5',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  emptyTitle: {
    fontFamily,
    fontSize: 20,
    fontWeight: '600',
    color: TEXT,
    letterSpacing: -0.3,
    marginBottom: 6,
  },
  emptyBody: {
    fontFamily,
    fontSize: 15,
    lineHeight: 21,
    color: SECONDARY,
    textAlign: 'center',
    maxWidth: 320,
  },
  loginButton: {
    marginTop: 16,
    backgroundColor: '#1a1a1a',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  loginButtonText: {
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
  },
  list: {
    flex: 1,
    minHeight: 0,
  },
  listContent: {
    paddingBottom: 24,
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 56,
    paddingHorizontal: 4,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: HAIRLINE,
    gap: 10,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  listRowText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  listRowTitle: {
    fontFamily,
    fontSize: 16,
    fontWeight: '600',
    color: TEXT,
    letterSpacing: -0.2,
  },
  listRowSub: {
    fontFamily,
    fontSize: 13,
    color: SECONDARY,
  },
  listRowMeta: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: ACCENT,
  },
  pageMeta: {
    fontFamily,
    fontSize: 14,
    fontWeight: '600',
    color: ACCENT,
  },
  subHeader: {
    flexShrink: 0,
    marginBottom: 8,
    gap: 6,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    marginLeft: -4,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  backText: {
    fontFamily,
    fontSize: 14,
    fontWeight: '600',
    color: ACCENT,
  },
  pageTitle: {
    fontFamily,
    fontSize: 22,
    fontWeight: '600',
    color: TEXT,
    letterSpacing: -0.4,
  },
  tabBar: {
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: HAIRLINE,
  },
  tabBarTabs: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 2,
  },
  tabBarTrailing: {
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingBottom: 6,
  },
  saveButton: {
    height: 32,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: ACCENT,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  saveButtonOn: {
    backgroundColor: GREEN,
    borderColor: GREEN,
  },
  saveButtonText: {
    fontFamily,
    fontSize: 14,
    fontWeight: '600',
    color: ACCENT,
  },
  saveButtonTextOn: {
    color: '#fff',
  },
  ghostButton: {
    height: 32,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: ACCENT,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  ghostButtonText: {
    fontFamily,
    fontSize: 14,
    fontWeight: '600',
    color: ACCENT,
  },
  newButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: ACCENT,
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 32,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  newButtonText: {
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
  },
  tab: {
    paddingHorizontal: 14,
    paddingTop: 6,
    paddingBottom: 11,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
    marginBottom: -StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  tabActive: {
    borderBottomColor: ACCENT,
  },
  tabLabel: {
    fontFamily,
    fontSize: 15,
    fontWeight: '500',
    color: SECONDARY,
    letterSpacing: -0.2,
  },
  tabLabelActive: {
    color: TEXT,
    fontWeight: '600',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  smallCard: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 18,
    gap: 12,
  },
  storeCard: {
    width: '96%',
    maxWidth: 560,
    maxHeight: Platform.OS === 'web' ? '80vh' : '80%',
    height: Platform.OS === 'web' ? 640 : '80%',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 18,
    gap: 12,
    overflow: 'hidden',
    zIndex: 2,
  },
  storePicker: {
    flex: 1,
    minHeight: 0,
    gap: 8,
  },
  storeSelectBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  storeSelectCount: {
    fontFamily,
    fontSize: 13,
    color: SECONDARY,
  },
  storeSelectAll: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: ACCENT,
  },
  storeListContent: {
    paddingBottom: 8,
  },
  storePickRowSelected: {
    backgroundColor: '#FFF7ED',
  },
  storeHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  storeTitleBlock: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  modalTitle: {
    fontFamily,
    fontSize: 18,
    fontWeight: '600',
    color: TEXT,
    letterSpacing: -0.3,
  },
  modalSub: {
    fontFamily,
    fontSize: 14,
    lineHeight: 20,
    color: SECONDARY,
  },
  kindRow: {
    flexDirection: 'row',
    gap: 8,
  },
  kindChip: {
    flex: 1,
    height: 36,
    borderRadius: 8,
    backgroundColor: FILL,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  kindChipActive: {
    backgroundColor: ACCENT,
  },
  kindChipText: {
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: TEXT,
  },
  kindChipTextActive: {
    color: '#fff',
  },
  fieldInput: {
    fontFamily,
    fontSize: 16,
    color: TEXT,
    backgroundColor: FILL,
    borderRadius: 8,
    paddingHorizontal: 12,
    minHeight: 44,
  },
  dateField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: FILL,
    borderRadius: 8,
    paddingHorizontal: 12,
    minHeight: 44,
  },
  dateFieldValue: {
    fontFamily,
    fontSize: 16,
    color: TEXT,
  },
  dateModalCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
  },
  dateModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  doneText: {
    fontFamily,
    fontSize: 16,
    fontWeight: '600',
    color: ACCENT,
  },
  errorText: {
    fontFamily,
    fontSize: 13,
    color: ACCENT,
  },
  lastTransferHint: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: TEXT,
  },
  lastTransferButton: {
    height: 44,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFF7ED',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  lastTransferButtonText: {
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: ACCENT,
  },
  modalActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  secondaryButton: {
    flex: 1,
    height: 44,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: FILL,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  secondaryButtonText: {
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: TEXT,
  },
  primaryButton: {
    backgroundColor: ACCENT,
    borderRadius: 6,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  primaryButtonInline: {
    flex: 1,
  },
  primaryButtonDisabled: {
    opacity: 0.6,
  },
  rangeRow: {
    flexDirection: 'row',
    gap: 10,
  },
  rangeField: {
    flex: 1,
    minWidth: 0,
    gap: 6,
  },
  rangeLabel: {
    fontFamily,
    fontSize: 12,
    fontWeight: '600',
    color: SECONDARY,
  },
  poRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 64,
    paddingHorizontal: 4,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: HAIRLINE,
    gap: 10,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  poRowText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  poRef: {
    fontFamily,
    fontSize: 16,
    fontWeight: '600',
    color: TEXT,
    letterSpacing: -0.2,
  },
  poSub: {
    fontFamily,
    fontSize: 13,
    color: SECONDARY,
  },
  poReview: {
    fontFamily,
    fontSize: 12,
    fontWeight: '600',
    color: ACCENT,
  },
  poThumbSlot: {
    width: 44,
    height: 44,
    borderRadius: 8,
    backgroundColor: FILL,
    alignItems: 'center',
    justifyContent: 'center',
  },
  poThumbPress: {
    width: 44,
    height: 44,
    borderRadius: 8,
    overflow: 'hidden',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  poThumb: {
    width: 44,
    height: 44,
    backgroundColor: FILL,
  },
  photoViewerRoot: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  photoViewerSheet: {
    width: '100%',
    maxWidth: 720,
    gap: 12,
  },
  photoViewerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  photoViewerTitle: {
    flex: 1,
    fontFamily,
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  photoViewerImage: {
    width: '100%',
    height: 420,
    backgroundColor: '#111',
    borderRadius: 10,
  },
  removePoButton: {
    width: 28,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  receivedGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  receivedButton: {
    height: 32,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: FILL,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  receivedButtonOn: {
    backgroundColor: GREEN,
  },
  receivedButtonText: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: TEXT,
  },
  receivedButtonTextOn: {
    color: '#fff',
  },
  primaryButtonText: {
    fontFamily,
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  meltSearchField: {
    marginBottom: 10,
  },
  docResultList: {
    maxHeight: 240,
  },
  docResultListContent: {
    paddingBottom: 4,
  },
  docResultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 52,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: HAIRLINE,
    gap: 10,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  docResultAction: {
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: ACCENT,
  },
  docResultActionMuted: {
    color: SECONDARY,
  },
  searchField: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 6,
    paddingHorizontal: 12,
    backgroundColor: FILL,
    minHeight: 42,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontFamily,
    fontSize: 16,
    color: TEXT,
    paddingVertical: 10,
    outlineStyle: 'none',
  },
  storeList: {
    flex: 1,
    minHeight: 0,
    ...Platform.select({
      web: { overflow: 'auto' },
      default: {},
    }),
  },
  storePickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 52,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: HAIRLINE,
    gap: 10,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  modalBusy: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 36,
  },
  modalEmpty: {
    fontFamily,
    fontSize: 14,
    color: SECONDARY,
    textAlign: 'center',
    paddingVertical: 28,
  },
  bullionCard: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: HAIRLINE,
    paddingVertical: 8,
  },
  bullionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 56,
    paddingHorizontal: 4,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  bullionStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  bullionStatusText: {
    fontFamily,
    fontSize: 12,
    fontWeight: '600',
    color: SECONDARY,
  },
  bullionNote: {
    fontFamily,
    fontSize: 13,
    color: SECONDARY,
    paddingHorizontal: 4,
    paddingBottom: 8,
  },
  bullionItems: {
    paddingHorizontal: 4,
    paddingBottom: 10,
    gap: 6,
  },
  bullionItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 6,
  },
  bullionItemName: {
    fontFamily,
    fontSize: 14,
    fontWeight: '600',
    color: TEXT,
  },
  bullionItemQty: {
    fontFamily,
    fontSize: 14,
    fontWeight: '700',
    color: TEXT,
  },
});
