import { createElement, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  buildFintracReportPortalUrl,
  clearFintracSession,
  createFintracReport,
  FINTRAC_PORTAL_ORIGIN,
  FINTRAC_STATUS,
  loadFintracSession,
  loadLinkedFintracReports,
  saveFintracReport,
  saveFintracSession,
  saveLinkedFintracReport,
  submitFintracReport,
  validateFintracReport,
} from '../api/fintrac';
import {
  buildLctrReportContentFromFields,
  buildLctrReportContentFromTransaction,
  FINTRAC_DEFAULT_PURPOSE,
  FINTRAC_IDENTIFIER_TYPE_CODE_DL,
  FINTRAC_LOCATION_IDS,
  mapAureusDetailToLctrFields,
  validateLctrFieldBag,
} from '../api/fintracLctr';
import {
  buildIrsReportedByTxn,
  fetchIrsReportingPayments,
  getIrsPaymentIdsToMark,
  markPaymentsReportedToIrs,
  normalizeAureusTxnId,
} from '../api/aureusIrs';
import {
  defaultDateRange,
  fetchTransactionDetail,
  fetchTransactionsAcrossPos,
  FINTRAC_CASH_THRESHOLD,
  formatAmount,
  formatDateParam,
  formatPickerDate,
  isFintracCash,
  isFintracExcludedStore,
  needsPaymentEnrichment,
  parseDateParam,
  resolvePosAuthForRow,
  withPaymentBreakdown,
} from '../api/transactions';

const fontFamily = Platform.select({
  ios: 'Sohne',
  android: 'Sohne',
  default: 'Sohne',
});

const ACCENT = '#8A5A3A';
const ADDED_GREEN = '#2F8A4E';

function statusLabel(status) {
  switch (status) {
    case FINTRAC_STATUS.submitted:
      return 'Added';
    case FINTRAC_STATUS.validated:
      return 'Ready to submit';
    case FINTRAC_STATUS.saved:
      return 'Saved';
    case FINTRAC_STATUS.created:
    default:
      return 'Draft';
  }
}

function isAddedInApp(item, linked) {
  if (item?.irsReported) return true;
  if (linked?.status === FINTRAC_STATUS.submitted) return true;
  if (linked?.aureusMarked) return true;
  return false;
}

function DateChip({ label, value, onChange, maximumDate, minimumDate }) {
  const dateValue = parseDateParam(value);

  if (Platform.OS === 'web') {
    return (
      <View style={styles.dateChip}>
        <Text style={styles.dateChipLabel}>{label}</Text>
        <View style={styles.dateChipControl}>
          <Ionicons name="calendar-outline" size={14} color="#6b6b6b" />
          {createElement('input', {
            type: 'date',
            value: formatDateParam(dateValue),
            max: maximumDate ? formatDateParam(maximumDate) : undefined,
            min: minimumDate ? formatDateParam(minimumDate) : undefined,
            onChange: (event) => {
              if (event.target.value) onChange(event.target.value);
            },
            style: {
              border: 'none',
              background: 'transparent',
              fontFamily,
              fontSize: 13,
              color: '#1a1a1a',
              padding: 0,
              margin: 0,
              outline: 'none',
              cursor: 'pointer',
              minWidth: 118,
            },
          })}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.dateChip}>
      <Text style={styles.dateChipLabel}>{label}</Text>
      <Text style={styles.dateChipValue}>{formatPickerDate(dateValue)}</Text>
    </View>
  );
}

function ConnectModal({ visible, onClose, onSaved }) {
  const [token, setToken] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (visible) {
      setToken('');
      setError('');
      setSaving(false);
    }
  }, [visible]);

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const session = await saveFintracSession({ token });
      onSaved(session);
      onClose();
    } catch (err) {
      setError(err?.message || 'Could not save FINTRAC token.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.modalCard}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Connect FINTRAC</Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <Ionicons name="close" size={18} color="#6b6b6b" />
            </Pressable>
          </View>
          <Text style={styles.modalBody}>
            Sign in at FINTRAC Web Reporting, open DevTools → Network on any API call, and paste
            the Authorization bearer token here. Tokens expire about every hour.
          </Text>
          <Pressable
            style={styles.linkRow}
            onPress={() => Linking.openURL(`${FINTRAC_PORTAL_ORIGIN}/manage-reports`)}
          >
            <Ionicons name="open-outline" size={14} color={ACCENT} />
            <Text style={styles.linkText}>Open FINTRAC manage reports</Text>
          </Pressable>
          <TextInput
            style={styles.tokenInput}
            value={token}
            onChangeText={setToken}
            placeholder="Bearer eyJ… or paste token only"
            placeholderTextColor="#999"
            autoCapitalize="none"
            autoCorrect={false}
            multiline
          />
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
          <Pressable
            style={[styles.primaryButton, saving && styles.primaryButtonDisabled]}
            onPress={save}
            disabled={saving}
          >
            {saving ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.primaryButtonText}>Save token</Text>
            )}
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const EDITABLE_FIELDS = [
  { key: 'reportingEntityReportReference', label: 'Transaction #' },
  { key: 'dateTimeOfTransaction', label: 'Date/time' },
  { key: 'reportingEntityLocationId', label: 'FINTRAC location id' },
  { key: 'storeName', label: 'Store name' },
  { key: 'amount', label: 'Cash amount' },
  { key: 'purpose', label: 'Purpose / description' },
  { key: 'clientNumber', label: 'Client ID' },
  { key: 'givenName', label: 'Given name' },
  { key: 'surname', label: 'Surname' },
  { key: 'telephoneNumber', label: 'Telephone' },
  { key: 'dateOfBirth', label: 'Date of birth' },
  { key: 'occupation', label: 'Occupation' },
  { key: 'identificationNumber', label: 'Government ID #' },
  { key: 'identificationProvinceStateCode', label: 'ID province' },
  { key: 'identifierTypeCode', label: 'ID type (4=DL, 3=Other/OT)' },
  { key: 'identifierTypeOther', label: 'ID type other (if 3)' },
  { key: 'buildingNumber', label: 'Building number' },
  { key: 'unitNumber', label: 'Unit (max 10)' },
  { key: 'streetAddress', label: 'Street name' },
  { key: 'city', label: 'City' },
  { key: 'provinceStateCode', label: 'Province' },
  { key: 'postalZipCode', label: 'Postal code' },
  { key: 'countryCode', label: 'Country' },
];

const LOCATION_HINT = Object.entries(FINTRAC_LOCATION_IDS)
  .map(([name, id]) => `${id}=${name}`)
  .join(' · ');

function emptyMappedFields(row) {
  const r = row || {};
  return {
    reportingEntityReportReference: normalizeAureusTxnId(r.reference || ''),
    dateTimeOfTransaction: '',
    reportingEntityLocationId: '',
    storeName: r.storeName || '',
    amount: r.cashAmount ?? r.amount ?? '',
    purpose: FINTRAC_DEFAULT_PURPOSE,
    clientNumber: '',
    givenName: '',
    surname: '',
    telephoneNumber: '',
    dateOfBirth: '',
    occupation: 'unknown',
    identificationNumber: '',
    identificationProvinceStateCode: '',
    identificationCountryCode: 'CA',
    identifierTypeCode: FINTRAC_IDENTIFIER_TYPE_CODE_DL,
    identifierTypeOther: '',
    buildingNumber: '',
    unitNumber: '',
    streetAddress: '',
    city: '',
    provinceStateCode: '',
    postalZipCode: '',
    countryCode: 'CA',
    currencyCode: 'CAD',
    timeZoneOffset: '-04:00',
  };
}

function ReviewModal({
  visible,
  row,
  linked,
  busy,
  error,
  message,
  onClose,
  onValidate,
  onSubmit,
}) {
  const [draft, setDraft] = useState(() => emptyMappedFields(row));
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!visible || !row) return;
    const base = {
      ...emptyMappedFields(row),
      ...(linked?.mappedFields || {}),
    };
    setDraft(base);
    setDirty(false);
  }, [visible, row?.id, linked?.mappedFields, linked?.incompleteReportUuid]);

  if (!visible || !row || !linked) return null;

  const status = linked.status || FINTRAC_STATUS.created;
  const submitted = status === FINTRAC_STATUS.submitted;
  const liveValidation = validateLctrFieldBag({
    ...draft,
    amount: draft.amount === '' ? '' : Number(draft.amount),
  });
  const missingKeys = new Set((liveValidation.missing || []).map((m) => m.field));
  const hasMissing = !liveValidation.ok;

  const setField = (key, value) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setDirty(true);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={[styles.modalCard, styles.reviewCard]}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Review FINTRAC report</Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <Ionicons name="close" size={18} color="#6b6b6b" />
            </Pressable>
          </View>

          <ScrollView style={styles.reviewScroll} contentContainerStyle={styles.reviewScrollContent}>
            <View style={styles.reviewMeta}>
              <Text style={styles.reviewRef}>
                {draft.reportingEntityReportReference || row.reference}
              </Text>
              <Text style={styles.reviewLine}>
                {row.customerName} · {row.storeName} · {row.amountLabel}
              </Text>
              <Text style={styles.reviewLine}>
                Status: {statusLabel(status)}
                {dirty ? ' · edited' : ''}
                {linked.incompleteReportUuid
                  ? ` · ${linked.incompleteReportUuid.slice(0, 8)}…`
                  : ''}
              </Text>
              <Text style={styles.reviewHint}>Location ids: {LOCATION_HINT}</Text>
              {linked.submitDateTime ? (
                <Text style={styles.reviewLine}>
                  Submitted {new Date(linked.submitDateTime).toLocaleString('en-CA')}
                </Text>
              ) : null}
              {linked.aureusMarked || row.irsReported ? (
                <Text style={styles.reviewLine}>Aureus IRS flag: reported</Text>
              ) : null}
            </View>

            <View style={styles.previewBox}>
              <Text style={styles.previewTitle}>Edit inputs before submit</Text>
              {EDITABLE_FIELDS.map((field) => {
                const missing = missingKeys.has(field.key);
                const value =
                  draft[field.key] == null || draft[field.key] === undefined
                    ? ''
                    : String(draft[field.key]);
                return (
                  <View
                    key={field.key}
                    style={[styles.editField, missing && styles.editFieldMissing]}
                  >
                    <Text style={[styles.editLabel, missing && styles.editLabelMissing]}>
                      {field.label}
                      {missing ? ' (required)' : ''}
                    </Text>
                    <TextInput
                      style={styles.editInput}
                      value={value}
                      editable={!submitted}
                      onChangeText={(text) => setField(field.key, text)}
                      placeholder={missing ? 'Enter value' : undefined}
                      placeholderTextColor="#b0b0b0"
                      autoCapitalize="none"
                      autoCorrect={false}
                    />
                  </View>
                );
              })}
            </View>

            {hasMissing ? (
              <View style={styles.validationBox}>
                <Text style={styles.validationTitle}>Missing or invalid inputs</Text>
                {liveValidation.missing.map((entry) => (
                  <Text key={entry.field} style={styles.validationItem}>
                    • {entry.label}
                  </Text>
                ))}
                <Text style={[styles.reviewLine, { marginTop: 6 }]}>
                  Fill the highlighted fields above, then Validate or Submit.
                </Text>
              </View>
            ) : null}

            {Array.isArray(linked.validationMessages) &&
            linked.validationMessages.length > 0 ? (
              <View style={styles.validationBox}>
                <Text style={styles.validationTitle}>FINTRAC validation messages</Text>
                {linked.validationMessages.map((entry, index) => (
                  <Text key={`${index}-${String(entry)}`} style={styles.validationItem}>
                    {typeof entry === 'string'
                      ? entry
                      : entry?.message?.en || entry?.message || JSON.stringify(entry)}
                  </Text>
                ))}
              </View>
            ) : null}

            {error ? <Text style={styles.errorText}>{error}</Text> : null}
            {message ? <Text style={styles.successText}>{message}</Text> : null}
          </ScrollView>

          <View style={styles.reviewActions}>
            {linked.incompleteReportUuid ? (
              <Pressable
                style={styles.secondaryButton}
                onPress={() =>
                  Linking.openURL(
                    buildFintracReportPortalUrl(linked.incompleteReportUuid, {
                      page: 'validation',
                    }),
                  )
                }
              >
                <Text style={styles.secondaryButtonText}>Open in FINTRAC</Text>
              </Pressable>
            ) : null}

            {!submitted ? (
              <Pressable
                style={[
                  styles.secondaryButton,
                  (busy || hasMissing) && styles.addButtonDisabled,
                ]}
                onPress={() => onValidate(normalizeDraftFields(draft))}
                disabled={Boolean(busy) || hasMissing}
              >
                <Text style={styles.secondaryButtonText}>
                  {busy === 'validate' ? 'Validating…' : 'Save & validate'}
                </Text>
              </Pressable>
            ) : null}

            {!submitted ? (
              <Pressable
                style={[
                  styles.primaryButtonCompact,
                  (busy || hasMissing) && styles.addButtonDisabled,
                ]}
                onPress={() => onSubmit(normalizeDraftFields(draft))}
                disabled={Boolean(busy) || hasMissing}
              >
                {busy === 'submit' ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.primaryButtonText}>Submit to FINTRAC</Text>
                )}
              </Pressable>
            ) : (
              <View style={styles.linkedBadge}>
                <Ionicons name="checkmark-circle" size={14} color="#2F8A4E" />
                <Text style={styles.linkedText}>Submitted</Text>
              </View>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

function normalizeDraftFields(draft) {
  const amountRaw = String(draft.amount ?? '').replace(/[$,\s]/g, '');
  const amount = amountRaw === '' ? '' : Math.round(Number(amountRaw));
  const idTypeRaw = String(draft.identifierTypeCode ?? '').trim();
  const identifierTypeCode =
    idTypeRaw === '' ? null : Number(idTypeRaw) || idTypeRaw;

  return {
    ...draft,
    amount,
    identifierTypeCode,
    identifierTypeOther: String(draft.identifierTypeOther || '').trim(),
    occupation: String(draft.occupation || '').trim() || 'unknown',
    unitNumber: String(draft.unitNumber || '').trim().slice(0, 10),
    buildingNumber: String(draft.buildingNumber || '').trim().slice(0, 10),
    countryCode: String(draft.countryCode || 'CA').trim() || 'CA',
    countryOfResidenceCode:
      String(draft.countryOfResidenceCode || draft.countryCode || 'CA').trim() || 'CA',
    identificationCountryCode: 'CA',
    currencyCode: draft.currencyCode || 'CAD',
    purpose: String(draft.purpose || '').trim() || FINTRAC_DEFAULT_PURPOSE,
  };
}

function resolveMissingFields(item, linked) {
  if (Array.isArray(linked?.missingFields) && linked.missingFields.length > 0) {
    return linked.missingFields;
  }
  if (Array.isArray(item?.fintracMissing) && item.fintracMissing.length > 0) {
    return item.fintracMissing;
  }
  return [];
}

function formatMissingLabels(missing) {
  const labels = (missing || [])
    .map((entry) => entry?.label || entry?.field)
    .filter(Boolean);
  if (!labels.length) return '';
  if (labels.length <= 2) return labels.join(', ');
  return `${labels.slice(0, 2).join(', ')} +${labels.length - 2}`;
}

function withFintracReadiness(row, detail) {
  if (!detail) {
    return {
      ...row,
      fintracMissing: row.fintracMissing || [],
      fintracMissingChecked: Boolean(row.fintracMissingChecked),
    };
  }
  try {
    const { validation } = mapAureusDetailToLctrFields(detail, row);
    return {
      ...row,
      fintracMissing: validation.ok ? [] : validation.missing,
      fintracMissingChecked: true,
    };
  } catch {
    return {
      ...row,
      fintracMissing: row.fintracMissing || [],
      fintracMissingChecked: true,
    };
  }
}

function FintracRow({
  item,
  linked,
  submitting,
  onAdd,
  onReview,
  disabled,
}) {
  const fintrac = isFintracCash(item);
  const added = isAddedInApp(item, linked);
  const alreadyLinked = Boolean(linked?.incompleteReportUuid);
  const status = linked?.status || FINTRAC_STATUS.created;
  const missing = added ? [] : resolveMissingFields(item, linked);
  const hasMissing = missing.length > 0;
  const missingLabel = formatMissingLabels(missing);

  return (
    <View style={[styles.row, hasMissing && styles.rowWithMissing]}>
      <Text style={[styles.cell, styles.colStore]} numberOfLines={1}>
        {item.storeName}
      </Text>
      <Text style={[styles.cell, styles.colDate]} numberOfLines={1}>
        {item.dateLabel}
      </Text>
      <Text style={[styles.cell, styles.colRef]} numberOfLines={1}>
        {item.reference}
      </Text>
      <Text style={[styles.cell, styles.colCustomer]} numberOfLines={1}>
        {item.customerName}
      </Text>
      <Text style={[styles.cell, styles.colPayment]} numberOfLines={1}>
        {item.paymentMethodLabel || '—'}
      </Text>
      <View style={[styles.cell, styles.colAmount]}>
        <View style={styles.amountInner}>
          {fintrac ? <View style={styles.fintracDot} /> : null}
          <Text
            style={[styles.amountText, fintrac && styles.amountFintrac]}
            numberOfLines={1}
          >
            {item.amountLabel}
          </Text>
        </View>
        {typeof item.cashAmount === 'number' ? (
          <Text style={styles.cashHint} numberOfLines={1}>
            cash {formatAmount(item.cashAmount)}
          </Text>
        ) : null}
      </View>
      <View style={styles.colAction}>
        {added ? (
          <Pressable
            style={styles.addedButton}
            onPress={() => (alreadyLinked ? onReview(item) : null)}
            disabled={!alreadyLinked}
          >
            <Ionicons name="checkmark-circle" size={14} color="#fff" />
            <Text style={styles.addedButtonText}>Added</Text>
          </Pressable>
        ) : alreadyLinked ? (
          <View style={styles.actionStack}>
            <View style={styles.actionButtonWrap}>
              <Pressable style={styles.linkedBadge} onPress={() => onReview(item)}>
                <Ionicons
                  name={
                    status === FINTRAC_STATUS.validated
                      ? 'shield-checkmark'
                      : 'document-text-outline'
                  }
                  size={13}
                  color={status === FINTRAC_STATUS.validated ? ADDED_GREEN : ACCENT}
                />
                <Text
                  style={[
                    styles.linkedText,
                    status !== FINTRAC_STATUS.validated && { color: ACCENT },
                  ]}
                  numberOfLines={1}
                >
                  {statusLabel(status)}
                </Text>
              </Pressable>
              {hasMissing ? <Text style={styles.missingStar}>*</Text> : null}
            </View>
            {hasMissing ? (
              <Text style={styles.missingHint} numberOfLines={2}>
                Missing: {missingLabel}
              </Text>
            ) : null}
          </View>
        ) : (
          <View style={styles.actionStack}>
            <View style={styles.actionButtonWrap}>
              <Pressable
                style={[
                  styles.addButton,
                  (disabled || submitting || !fintrac) && styles.addButtonDisabled,
                ]}
                onPress={() => onAdd(item)}
                disabled={disabled || submitting || !fintrac}
              >
                {submitting ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.addButtonText}>Add to FINTRAC</Text>
                )}
              </Pressable>
              {hasMissing ? <Text style={styles.missingStar}>*</Text> : null}
            </View>
            {hasMissing ? (
              <Text style={styles.missingHint} numberOfLines={2}>
                Missing: {missingLabel}
              </Text>
            ) : null}
          </View>
        )}
      </View>
    </View>
  );
}

export default function FintracScreen({ session, onRequireLogin }) {
  const initialRange = useMemo(() => defaultDateRange(31), []);
  const [startDate, setStartDate] = useState(() => initialRange.start);
  const [endDate, setEndDate] = useState(() => initialRange.end);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [selectedStore, setSelectedStore] = useState(null);
  const [cashOnly, setCashOnly] = useState(true);
  const [fintracSession, setFintracSession] = useState(null);
  const [connectOpen, setConnectOpen] = useState(false);
  const [linked, setLinked] = useState({});
  const [submittingId, setSubmittingId] = useState(null);
  const [actionMessage, setActionMessage] = useState('');
  const [actionError, setActionError] = useState('');
  const [reviewRow, setReviewRow] = useState(null);
  const [reviewBusy, setReviewBusy] = useState('');
  const [reviewError, setReviewError] = useState('');
  const [reviewMessage, setReviewMessage] = useState('');
  const requestId = useRef(0);
  const enrichRequestId = useRef(0);
  const paymentCache = useRef({});
  const irsByTxnRef = useRef(new Map());

  const startKey = formatDateParam(startDate);
  const endKey = formatDateParam(endDate);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [ftSession, linkedMap] = await Promise.all([
        loadFintracSession(),
        loadLinkedFintracReports(),
      ]);
      if (cancelled) return;
      setFintracSession(ftSession);
      setLinked(linkedMap);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const applyIrsOverlay = useCallback((txRows, irsMap) => {
    if (!irsMap || irsMap.size === 0) return txRows;
    return txRows.map((row) => {
      const txnId = normalizeAureusTxnId(row.reference);
      const entry = irsMap.get(txnId);
      if (!entry) return row;
      return {
        ...row,
        irsReported: Boolean(entry.reported || row.irsReported),
        irsPaymentIds: entry.paymentIds?.length
          ? entry.paymentIds
          : row.irsPaymentIds || [],
      };
    });
  }, []);

  const load = useCallback(async () => {
    if (!session?.token) {
      setRows([]);
      setError('');
      return;
    }

    const id = ++requestId.current;
    setLoading(true);
    setError('');
    setActionMessage('');
    setActionError('');

    try {
      const [result, irsPayments] = await Promise.all([
        fetchTransactionsAcrossPos(session, {
          startDate: startKey,
          endDate: endKey,
          includePurchases: false,
        }),
        fetchIrsReportingPayments(session.token, {
          startDate: startKey,
          endDate: endKey,
          baseUrl: session.baseUrl,
        }).catch(() => []),
      ]);
      if (id !== requestId.current) return;
      const irsMap = buildIrsReportedByTxn(irsPayments);
      irsByTxnRef.current = irsMap;
      setRows(applyIrsOverlay(result.rows, irsMap));
      paymentCache.current = {};
      if (result.warning) {
        setActionError(result.warning);
      }
    } catch (err) {
      if (id !== requestId.current) return;
      setRows([]);
      setError(err?.message || 'Failed to load transactions.');
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [session?.token, session?.baseUrl, startKey, endKey, applyIrsOverlay]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!session?.token || rows.length === 0) return;

    const candidates = rows.filter((row) => {
      if (row.type !== 'order') return false;
      if (row.paymentBreakdown && row.fintracMissingChecked) {
        return false;
      }
      // Enrich every SO that could be ≥ $10k cash (total ≥ threshold, or already flagged).
      return (
        needsPaymentEnrichment(row) ||
        Number(row.amount) >= FINTRAC_CASH_THRESHOLD ||
        (isFintracCash(row) && !row.fintracMissingChecked)
      );
    });
    if (candidates.length === 0) return;

    const enrichId = ++enrichRequestId.current;
    let cancelled = false;

    (async () => {
      const queue = [...candidates];
      const workers = Array.from({ length: Math.min(6, queue.length) }, async () => {
        while (queue.length && !cancelled && enrichId === enrichRequestId.current) {
          const row = queue.shift();
          if (!row) continue;
          const cached = paymentCache.current[row.id];
          if (cached?.paymentBreakdown && cached?.fintracMissingChecked) continue;
          try {
            const auth = resolvePosAuthForRow(session, row);
            const detailPayload = await fetchTransactionDetail(auth.token, {
              type: row.type,
              sourceId: row.sourceId,
              baseUrl: auth.baseUrl,
            });
            if (cancelled || enrichId !== enrichRequestId.current) return;
            let enriched = withPaymentBreakdown(row, detailPayload);
            enriched = withFintracReadiness(enriched, detailPayload);
            const txnId = normalizeAureusTxnId(row.reference);
            const irsEntry = irsByTxnRef.current.get(txnId);
            if (irsEntry?.reported) {
              enriched = { ...enriched, irsReported: true };
            }
            paymentCache.current[row.id] = enriched;
            setRows((current) =>
              current.map((entry) => (entry.id === row.id ? enriched : entry)),
            );
          } catch {
            // keep heuristic flag
          }
        }
      });
      await Promise.all(workers);
    })();

    return () => {
      cancelled = true;
    };
  }, [session?.token, session?.linked, rows.length, startKey, endKey]);

  const storeNames = useMemo(() => {
    const names = new Set(
      rows
        .filter((row) => !isFintracExcludedStore(row.storeName))
        .map((row) => row.storeName || '—'),
    );
    return Array.from(names).sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: 'base' }),
    );
  }, [rows]);

  const fintracCount = useMemo(
    () =>
      rows.reduce(
        (count, row) =>
          count +
          (isFintracCash(row) && !isFintracExcludedStore(row.storeName) ? 1 : 0),
        0,
      ),
    [rows],
  );

  const filteredRows = useMemo(() => {
    let result = rows.filter((row) => !isFintracExcludedStore(row.storeName));
    if (selectedStore) {
      result = result.filter(
        (row) =>
          row.storeName.localeCompare(selectedStore, undefined, {
            sensitivity: 'base',
          }) === 0,
      );
    }
    if (cashOnly) {
      result = result.filter((row) => isFintracCash(row));
    }
    const q = query.trim().toLowerCase();
    if (q) {
      result = result.filter((row) => row.searchText.includes(q));
    }
    return result;
  }, [rows, selectedStore, cashOnly, query]);

  const fintracConnected = Boolean(fintracSession?.token) && !fintracSession?.expired;

  const openReview = useCallback((row) => {
    setReviewRow(row);
    setReviewError('');
    setReviewMessage('');
    setReviewBusy('');
  }, []);

  const closeReview = useCallback(() => {
    setReviewRow(null);
    setReviewError('');
    setReviewMessage('');
    setReviewBusy('');
  }, []);

  const handleAdd = async (row) => {
    setActionError('');
    setActionMessage('');

    if (isAddedInApp(row, linked[row.id])) {
      openReview(row);
      return;
    }

    if (!fintracConnected) {
      setConnectOpen(true);
      setActionError('Connect FINTRAC before creating a report.');
      return;
    }

    setSubmittingId(row.id);
    try {
      const auth = resolvePosAuthForRow(session, row);
      const detail = await fetchTransactionDetail(auth.token, {
        type: row.type,
        sourceId: row.sourceId,
        baseUrl: auth.baseUrl,
      });
      let enriched = withPaymentBreakdown(row, detail);
      enriched = withFintracReadiness(enriched, detail);
      paymentCache.current[row.id] = enriched;
      setRows((current) =>
        current.map((entry) => (entry.id === row.id ? enriched : entry)),
      );

      const mapped = buildLctrReportContentFromTransaction(enriched, detail);
      const paymentIds =
        getIrsPaymentIdsToMark(detail).length > 0
          ? getIrsPaymentIdsToMark(detail)
          : enriched.irsPaymentIds || [];

      if (!mapped.ok) {
        const nextLinked = await saveLinkedFintracReport(row.id, {
          incompleteReportUuid: linked[row.id]?.incompleteReportUuid || null,
          reference: row.reference,
          reportingEntityReportReference: mapped.fields?.reportingEntityReportReference,
          mappedFields: mapped.fields || emptyMappedFields(enriched),
          missingFields: mapped.missing,
          reportContent: null,
          status: FINTRAC_STATUS.created,
          irsPaymentIds: paymentIds,
        });
        setLinked(nextLinked);
        setRows((current) =>
          current.map((entry) =>
            entry.id === row.id
              ? {
                  ...enriched,
                  fintracMissing: mapped.missing || [],
                  fintracMissingChecked: true,
                }
              : entry,
          ),
        );
        setReviewRow(enriched);
        setReviewError('Some inputs are missing — edit them below, then Save & validate.');
        setReviewMessage('');
        setActionError(`${row.reference}: complete missing inputs in the review form.`);
        return;
      }

      const created = await createFintracReport(fintracSession.token);
      const saved = await saveFintracReport(fintracSession.token, {
        incompleteReportUuid: created.incompleteReportUuid,
        reportContent: mapped.reportContent,
        reportingEntityReportReference: mapped.fields.reportingEntityReportReference,
      });
      const validated = await validateFintracReport(fintracSession.token, {
        incompleteReportUuid: created.incompleteReportUuid,
      });

      const nextLinked = await saveLinkedFintracReport(row.id, {
        ...created,
        ...saved,
        ...validated,
        reference: row.reference,
        reportingEntityReportReference: mapped.fields.reportingEntityReportReference,
        reportContent: mapped.reportContent,
        mappedFields: mapped.fields,
        missingFields: [],
        personRefId: mapped.personRefId,
        irsPaymentIds: paymentIds,
        status: validated.valid ? FINTRAC_STATUS.validated : FINTRAC_STATUS.saved,
      });
      setLinked(nextLinked);
      setReviewRow(enriched);
      setReviewError(
        validated.valid
          ? ''
          : 'FINTRAC validation returned issues — review messages before submit.',
      );
      setReviewMessage(
        validated.valid
          ? 'Auto-filled and validated. Review the inputs, then submit.'
          : saved.message || 'Saved draft — validation needs attention.',
      );
      setActionMessage(
        `${row.reference}: ${validated.valid ? 'ready to submit' : 'saved — check validation'}`,
      );
    } catch (err) {
      if (err?.status === 401) {
        setFintracSession((current) =>
          current ? { ...current, expired: true } : current,
        );
        setConnectOpen(true);
      }
      setActionError(err?.message || 'Failed to prepare FINTRAC report.');
    } finally {
      setSubmittingId(null);
    }
  };

  const applyFieldsAndValidate = async (draftFields, { submitAfter = false } = {}) => {
    if (!reviewRow || !fintracConnected) return;
    const current = linked[reviewRow.id] || {};

    const validation = validateLctrFieldBag(draftFields);
    if (!validation.ok) {
      const nextLinked = await saveLinkedFintracReport(reviewRow.id, {
        ...current,
        mappedFields: draftFields,
        missingFields: validation.missing,
        reportContent: null,
        status: FINTRAC_STATUS.created,
      });
      setLinked(nextLinked);
      setRows((currentRows) =>
        currentRows.map((entry) =>
          entry.id === reviewRow.id
            ? {
                ...entry,
                fintracMissing: validation.missing,
                fintracMissingChecked: true,
              }
            : entry,
        ),
      );
      setReviewError('Fill the highlighted required fields before continuing.');
      return;
    }

    setReviewBusy(submitAfter ? 'submit' : 'validate');
    setReviewError('');
    setReviewMessage('');

    try {
      const personRefId = current.personRefId || undefined;
      const reportContent = buildLctrReportContentFromFields(draftFields, {
        personRefId,
      });
      const contentPersonRefId =
        reportContent?.definitions?.[0]?.refId || personRefId || null;

      let incompleteReportUuid = current.incompleteReportUuid;
      let createdMeta = current;

      if (!incompleteReportUuid) {
        const created = await createFintracReport(fintracSession.token);
        incompleteReportUuid = created.incompleteReportUuid;
        createdMeta = { ...current, ...created };
      }

      const saved = await saveFintracReport(fintracSession.token, {
        incompleteReportUuid,
        reportContent,
        reportingEntityReportReference: draftFields.reportingEntityReportReference,
      });

      const validated = await validateFintracReport(fintracSession.token, {
        incompleteReportUuid,
      });

      let nextState = {
        ...createdMeta,
        ...saved,
        ...validated,
        reference: reviewRow.reference,
        reportingEntityReportReference: draftFields.reportingEntityReportReference,
        reportContent,
        mappedFields: draftFields,
        missingFields: [],
        personRefId: contentPersonRefId,
        irsPaymentIds: current.irsPaymentIds || reviewRow.irsPaymentIds || [],
        status: validated.valid ? FINTRAC_STATUS.validated : FINTRAC_STATUS.saved,
      };

      if (!validated.valid) {
        const nextLinked = await saveLinkedFintracReport(reviewRow.id, nextState);
        setLinked(nextLinked);
        setReviewError('FINTRAC validation returned issues — see messages above.');
        setReviewMessage(saved.message || 'Saved draft.');
        return;
      }

      if (!submitAfter) {
        const nextLinked = await saveLinkedFintracReport(reviewRow.id, nextState);
        setLinked(nextLinked);
        setRows((currentRows) =>
          currentRows.map((entry) =>
            entry.id === reviewRow.id
              ? { ...entry, fintracMissing: [], fintracMissingChecked: true }
              : entry,
          ),
        );
        setReviewMessage('Saved and validated. Review inputs, then submit.');
        return;
      }

      const result = await submitFintracReport(fintracSession.token, {
        incompleteReportUuid,
        reportTypeCode: nextState.reportTypeCode,
        reportingEntityNumber: nextState.reportingEntityNumber,
        submittingReportingEntityNumber: nextState.submittingReportingEntityNumber,
      });

      let paymentIds = nextState.irsPaymentIds || [];
      let aureusMarked = false;
      let aureusMarkError = '';

      try {
        if (!paymentIds.length) {
          const auth = resolvePosAuthForRow(session, reviewRow);
          const detail = await fetchTransactionDetail(auth.token, {
            type: reviewRow.type,
            sourceId: reviewRow.sourceId,
            baseUrl: auth.baseUrl,
          });
          paymentIds = getIrsPaymentIdsToMark(detail);
          const enriched = withPaymentBreakdown(reviewRow, detail);
          paymentCache.current[reviewRow.id] = enriched;
          setRows((currentRows) =>
            currentRows.map((entry) =>
              entry.id === reviewRow.id ? { ...enriched, irsReported: true } : entry,
            ),
          );
        }

        if (paymentIds.length) {
          const auth = resolvePosAuthForRow(session, reviewRow);
          await markPaymentsReportedToIrs(
            auth.token,
            paymentIds,
            auth.baseUrl,
          );
          aureusMarked = true;
          const txnId = normalizeAureusTxnId(reviewRow.reference);
          const existing = irsByTxnRef.current.get(txnId) || {
            reported: false,
            paymentIds: [],
            payments: [],
          };
          irsByTxnRef.current.set(txnId, {
            ...existing,
            reported: true,
            paymentIds: Array.from(
              new Set([...(existing.paymentIds || []), ...paymentIds.map(String)]),
            ),
          });
          setRows((currentRows) =>
            currentRows.map((entry) =>
              entry.id === reviewRow.id
                ? {
                    ...entry,
                    irsReported: true,
                    irsPaymentIds: paymentIds.map(String),
                  }
                : entry,
            ),
          );
        } else {
          aureusMarkError =
            'FINTRAC submitted, but no Aureus cash payment ids were found to mark.';
        }
      } catch (markErr) {
        aureusMarkError =
          markErr?.message ||
          'FINTRAC submitted, but marking Aureus reported_to_irs failed.';
      }

      nextState = {
        ...nextState,
        ...result,
        irsPaymentIds: paymentIds,
        aureusMarked,
        status: FINTRAC_STATUS.submitted,
      };
      const nextLinked = await saveLinkedFintracReport(reviewRow.id, nextState);
      setLinked(nextLinked);

      if (aureusMarkError) {
        setReviewError(aureusMarkError);
        setReviewMessage(
          `Submitted to FINTRAC${result.reportingEntityReportReference ? ` · ${result.reportingEntityReportReference}` : ''}.`,
        );
      } else {
        setReviewMessage(
          `Submitted and marked in Aureus${result.reportingEntityReportReference ? ` · ${result.reportingEntityReportReference}` : ''}.`,
        );
      }
      setActionMessage(`${reviewRow.reference}: submitted to FINTRAC`);
    } catch (err) {
      const msg = err?.message || '';
      if (
        err?.status === 401 ||
        /not allowed to submit|session expired|reconnect/i.test(msg)
      ) {
        setFintracSession((c) => (c ? { ...c, expired: true } : c));
        setConnectOpen(true);
      }
      setReviewError(err?.message || (submitAfter ? 'Submit failed.' : 'Validate failed.'));
    } finally {
      setReviewBusy('');
    }
  };

  const handleValidate = async (draftFields) => {
    await applyFieldsAndValidate(draftFields, { submitAfter: false });
  };

  const handleSubmit = async (draftFields) => {
    await applyFieldsAndValidate(draftFields, { submitAfter: true });
  };

  const disconnect = async () => {
    await clearFintracSession();
    setFintracSession(null);
    setActionMessage('Disconnected from FINTRAC.');
  };

  if (!session?.token) {
    return (
      <View style={styles.body}>
        <Text style={styles.emptyText}>
          Sign in from Profile to load Aureus POS transactions.
        </Text>
        <Pressable style={styles.primaryButton} onPress={onRequireLogin}>
          <Text style={styles.primaryButtonText}>Go to Profile</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.body}>
      <View style={styles.toolbar}>
        <View style={styles.search}>
          <Ionicons name="search-outline" size={15} color="#8a8a8a" style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            value={query}
            onChangeText={setQuery}
            placeholder="Search customer, store, SO#…"
            placeholderTextColor="#999"
            autoCapitalize="none"
            autoCorrect={false}
            clearButtonMode="while-editing"
          />
          {query ? (
            <Pressable onPress={() => setQuery('')} hitSlop={8}>
              <Ionicons name="close-circle" size={15} color="#b0b0b0" />
            </Pressable>
          ) : null}
        </View>

        <DateChip
          label="From"
          value={startDate}
          onChange={(next) => {
            const date = parseDateParam(next);
            setStartDate(date);
            if (date > endDate) setEndDate(date);
          }}
          maximumDate={endDate}
        />
        <Text style={styles.dateSep}>–</Text>
        <DateChip
          label="To"
          value={endDate}
          onChange={(next) => {
            const date = parseDateParam(next);
            setEndDate(date);
            if (date < startDate) setStartDate(date);
          }}
          minimumDate={startDate}
          maximumDate={new Date()}
        />
      </View>

      <View style={styles.connectBar}>
        <View style={styles.connectInfo}>
          <Ionicons
            name={fintracConnected ? 'shield-checkmark-outline' : 'shield-outline'}
            size={16}
            color={fintracConnected ? '#2F8A4E' : ACCENT}
          />
          <View style={styles.connectCopy}>
            <Text style={styles.connectTitle}>
              {fintracConnected
                ? `Connected · ${fintracSession.email || fintracSession.name || 'FINTRAC'}`
                : fintracSession?.expired
                  ? 'FINTRAC token expired'
                  : 'FINTRAC not connected'}
            </Text>
            <Text style={styles.connectHint}>
              {fintracConnected
                ? `Expires ${fintracSession.expiresAtLabel || 'soon'}`
                : 'Paste a bearer token from FINTRAC Web Reporting to create LCTR drafts.'}
            </Text>
          </View>
        </View>
        <View style={styles.connectActions}>
          {fintracConnected ? (
            <Pressable style={styles.secondaryButton} onPress={disconnect}>
              <Text style={styles.secondaryButtonText}>Disconnect</Text>
            </Pressable>
          ) : null}
          <Pressable style={styles.primaryButtonCompact} onPress={() => setConnectOpen(true)}>
            <Text style={styles.primaryButtonText}>
              {fintracConnected ? 'Update token' : 'Connect'}
            </Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.filterRow}>
        <Pressable
          style={[styles.filterChip, cashOnly && styles.filterChipActive]}
          onPress={() => setCashOnly((current) => !current)}
        >
          <Ionicons
            name={cashOnly ? 'checkbox' : 'square-outline'}
            size={15}
            color={cashOnly ? ACCENT : '#9a9a9a'}
          />
          <Text style={[styles.filterChipText, cashOnly && styles.filterChipTextActive]}>
            Cash ≥ {formatAmount(FINTRAC_CASH_THRESHOLD)}
            {fintracCount ? ` · ${fintracCount}` : ''}
          </Text>
        </Pressable>
      </View>

      <View style={styles.storeFilterRow}>
        <Pressable
          style={[styles.storeChip, !selectedStore && styles.storeChipActive]}
          onPress={() => setSelectedStore(null)}
        >
          <Text style={[styles.storeChipText, !selectedStore && styles.storeChipTextActive]}>
            All stores
          </Text>
        </Pressable>
        {storeNames.map((name) => (
          <Pressable
            key={name}
            style={[styles.storeChip, selectedStore === name && styles.storeChipActive]}
            onPress={() =>
              setSelectedStore((current) => (current === name ? null : name))
            }
          >
            <Text
              style={[
                styles.storeChipText,
                selectedStore === name && styles.storeChipTextActive,
              ]}
            >
              {name}
            </Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.metaRow}>
        <Text style={styles.metaText}>
          {loading && rows.length === 0
            ? 'Loading…'
            : `${filteredRows.length}${
                filteredRows.length !== rows.length ? ` of ${rows.length}` : ''
              } transactions`}
          {cashOnly ? ' · cash ≥ $10k' : ''}
          {selectedStore ? ` · ${selectedStore}` : ''}
        </Text>
        {loading && rows.length > 0 ? <ActivityIndicator size="small" color="#8a8a8a" /> : null}
      </View>

      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      {actionError ? <Text style={styles.errorText}>{actionError}</Text> : null}
      {actionMessage ? <Text style={styles.successText}>{actionMessage}</Text> : null}

      {loading && rows.length === 0 ? (
        <View style={styles.centered}>
          <ActivityIndicator color="#1a1a1a" />
        </View>
      ) : (
        <View style={styles.tableWrap}>
          <View style={[styles.row, styles.headerRow]}>
            <Text style={[styles.headerText, styles.colStore]}>Store</Text>
            <Text style={[styles.headerText, styles.colDate]}>Date</Text>
            <Text style={[styles.headerText, styles.colRef]}>Ref</Text>
            <Text style={[styles.headerText, styles.colCustomer]}>Customer</Text>
            <Text style={[styles.headerText, styles.colPayment]}>Payment</Text>
            <Text style={[styles.headerText, styles.colAmount, styles.headerRight]}>Amount</Text>
            <Text style={[styles.headerText, styles.colAction, styles.headerRight]}>FINTRAC</Text>
          </View>
          <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
            {filteredRows.length === 0 ? (
              <View style={styles.empty}>
                <Text style={styles.emptyText}>
                  {query.trim() || selectedStore || cashOnly
                    ? 'No transactions match the current filters.'
                    : 'No transactions in this date range.'}
                </Text>
              </View>
            ) : (
              filteredRows.map((item) => (
                <FintracRow
                  key={item.id}
                  item={item}
                  linked={linked[item.id]}
                  submitting={submittingId === item.id}
                  onAdd={handleAdd}
                  onReview={openReview}
                  disabled={Boolean(submittingId)}
                />
              ))
            )}
          </ScrollView>
        </View>
      )}

      <ConnectModal
        visible={connectOpen}
        onClose={() => setConnectOpen(false)}
        onSaved={(next) => {
          setFintracSession(next);
          setActionError('');
          setActionMessage(`Connected as ${next.email || next.name || 'FINTRAC user'}.`);
        }}
      />

      <ReviewModal
        visible={Boolean(reviewRow)}
        row={reviewRow}
        linked={reviewRow ? linked[reviewRow.id] : null}
        busy={reviewBusy}
        error={reviewError}
        message={reviewMessage}
        onClose={closeReview}
        onValidate={handleValidate}
        onSubmit={handleSubmit}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
    gap: 10,
    minHeight: 0,
  },
  toolbar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
  },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    minWidth: 220,
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    paddingHorizontal: 10,
    height: 36,
  },
  searchIcon: {
    marginRight: 6,
  },
  searchInput: {
    flex: 1,
    fontFamily,
    fontSize: 13,
    color: '#1a1a1a',
    paddingVertical: 0,
    outlineStyle: 'none',
  },
  dateChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    paddingHorizontal: 10,
    height: 36,
  },
  dateChipLabel: {
    fontFamily,
    fontSize: 11,
    fontWeight: '600',
    color: '#8a8a8a',
  },
  dateChipControl: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  dateChipValue: {
    fontFamily,
    fontSize: 13,
    color: '#1a1a1a',
  },
  dateSep: {
    fontFamily,
    color: '#b0b0b0',
  },
  connectBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    padding: 12,
    borderRadius: 10,
    backgroundColor: '#F7F0EA',
    flexWrap: 'wrap',
  },
  connectInfo: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    flex: 1,
    minWidth: 220,
  },
  connectCopy: {
    flex: 1,
    gap: 2,
  },
  connectTitle: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  connectHint: {
    fontFamily,
    fontSize: 12,
    color: '#6b6b6b',
  },
  connectActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: '#f3f3f3',
  },
  filterChipActive: {
    backgroundColor: '#F7F0EA',
  },
  filterChipText: {
    fontFamily,
    fontSize: 12,
    fontWeight: '500',
    color: '#6b6b6b',
  },
  filterChipTextActive: {
    color: ACCENT,
    fontWeight: '600',
  },
  storeFilterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  storeChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#f3f3f3',
  },
  storeChipActive: {
    backgroundColor: '#F7F0EA',
  },
  storeChipText: {
    fontFamily,
    fontSize: 12,
    fontWeight: '500',
    color: '#6b6b6b',
  },
  storeChipTextActive: {
    color: ACCENT,
    fontWeight: '600',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  metaText: {
    fontFamily,
    fontSize: 12,
    color: '#8a8a8a',
  },
  tableWrap: {
    flex: 1,
    minHeight: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e8e8e8',
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingBottom: 24,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    minHeight: 40,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f0f0f0',
    gap: 6,
    paddingRight: 4,
  },
  rowWithMissing: {
    alignItems: 'flex-start',
    paddingTop: 8,
    paddingBottom: 8,
  },
  headerRow: {
    borderBottomColor: '#e5e5e5',
    minHeight: 30,
  },
  headerText: {
    fontFamily,
    fontSize: 11,
    fontWeight: '600',
    color: '#9a9a9a',
    letterSpacing: 0.2,
  },
  headerRight: {
    textAlign: 'right',
  },
  cell: {
    fontFamily,
    fontSize: 12,
    color: '#1a1a1a',
  },
  colStore: { width: '14%', minWidth: 90 },
  colDate: { width: '10%', minWidth: 72 },
  colRef: { width: '11%', minWidth: 72 },
  colCustomer: { flex: 1, minWidth: 100 },
  colPayment: { width: '12%', minWidth: 80 },
  colAmount: { width: '12%', minWidth: 88, alignItems: 'flex-end' },
  colAction: { width: 132, alignItems: 'flex-end' },
  actionStack: {
    alignItems: 'flex-end',
    gap: 3,
    maxWidth: 132,
  },
  actionButtonWrap: {
    position: 'relative',
  },
  missingStar: {
    position: 'absolute',
    top: -6,
    right: -2,
    fontFamily,
    fontSize: 16,
    fontWeight: '700',
    color: '#DC2626',
    lineHeight: 16,
  },
  missingHint: {
    fontFamily,
    fontSize: 9,
    lineHeight: 11,
    color: '#B91C1C',
    textAlign: 'right',
    maxWidth: 128,
  },
  amountInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  amountText: {
    fontFamily,
    fontSize: 12,
    color: '#1a1a1a',
    fontVariant: ['tabular-nums'],
  },
  amountFintrac: {
    color: '#8a1c1c',
    fontWeight: '600',
  },
  fintracDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#8a1c1c',
  },
  cashHint: {
    fontFamily,
    fontSize: 10,
    color: '#9a9a9a',
    marginTop: 1,
  },
  addButton: {
    backgroundColor: ACCENT,
    borderRadius: 7,
    paddingHorizontal: 8,
    paddingVertical: 7,
    minWidth: 112,
    alignItems: 'center',
  },
  addButtonDisabled: {
    opacity: 0.45,
  },
  addButtonText: {
    fontFamily,
    fontSize: 11,
    fontWeight: '600',
    color: '#fff',
  },
  addedButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: ADDED_GREEN,
    borderRadius: 7,
    paddingHorizontal: 10,
    paddingVertical: 7,
    minWidth: 112,
    justifyContent: 'center',
  },
  addedButtonText: {
    fontFamily,
    fontSize: 11,
    fontWeight: '700',
    color: '#fff',
  },
  linkedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  linkedText: {
    fontFamily,
    fontSize: 11,
    fontWeight: '600',
    color: '#2F8A4E',
  },
  empty: {
    paddingVertical: 28,
    alignItems: 'center',
  },
  emptyText: {
    fontFamily,
    fontSize: 13,
    color: '#8a8a8a',
    textAlign: 'center',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
  },
  errorText: {
    fontFamily,
    fontSize: 12,
    color: '#B91C1C',
  },
  successText: {
    fontFamily,
    fontSize: 12,
    color: '#2F8A4E',
  },
  primaryButton: {
    backgroundColor: ACCENT,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    alignItems: 'center',
    alignSelf: 'flex-start',
  },
  primaryButtonCompact: {
    backgroundColor: ACCENT,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignItems: 'center',
  },
  primaryButtonDisabled: {
    opacity: 0.6,
  },
  primaryButtonText: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: '#fff',
  },
  secondaryButton: {
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#fff',
  },
  secondaryButtonText: {
    fontFamily,
    fontSize: 13,
    fontWeight: '500',
    color: '#6b6b6b',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  modalCard: {
    width: '100%',
    maxWidth: 480,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    gap: 10,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  modalTitle: {
    fontFamily,
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  modalBody: {
    fontFamily,
    fontSize: 13,
    lineHeight: 18,
    color: '#4a4a4a',
  },
  reviewCard: {
    maxWidth: 560,
    maxHeight: '90%',
  },
  reviewScroll: {
    maxHeight: 480,
  },
  reviewScrollContent: {
    gap: 10,
    paddingBottom: 4,
  },
  reviewMeta: {
    gap: 4,
  },
  reviewRef: {
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  reviewLine: {
    fontFamily,
    fontSize: 12,
    color: '#6b6b6b',
  },
  reviewHint: {
    fontFamily,
    fontSize: 11,
    color: '#8a8a8a',
    marginTop: 2,
  },
  previewBox: {
    backgroundColor: '#F7F7F7',
    borderRadius: 8,
    padding: 10,
    gap: 6,
  },
  previewTitle: {
    fontFamily,
    fontSize: 12,
    fontWeight: '600',
    color: '#6b6b6b',
    marginBottom: 2,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  editField: {
    gap: 3,
    paddingVertical: 2,
  },
  editFieldMissing: {
    backgroundColor: '#FFF7ED',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 6,
    marginHorizontal: -4,
  },
  editLabel: {
    fontFamily,
    fontSize: 11,
    color: '#8a8a8a',
  },
  editLabelMissing: {
    color: '#9A3412',
    fontWeight: '600',
  },
  editInput: {
    fontFamily,
    fontSize: 13,
    color: '#1a1a1a',
    backgroundColor: '#fff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#ddd',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: Platform.select({ ios: 8, default: 6 }),
  },
  reviewActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  validationBox: {
    backgroundColor: '#FFF7ED',
    borderRadius: 8,
    padding: 10,
    gap: 4,
  },
  validationTitle: {
    fontFamily,
    fontSize: 12,
    fontWeight: '600',
    color: '#9A3412',
  },
  validationItem: {
    fontFamily,
    fontSize: 12,
    color: '#7C2D12',
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  linkText: {
    fontFamily,
    fontSize: 13,
    color: ACCENT,
    fontWeight: '500',
  },
  tokenInput: {
    minHeight: 96,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 10,
    fontFamily: 'SohneMono',
    fontSize: 11,
    color: '#1a1a1a',
    textAlignVertical: 'top',
  },
});
