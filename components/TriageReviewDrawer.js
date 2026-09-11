import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
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
  fetchTransactionDetail,
  resolvePosAuthForRow,
  withLineItems,
} from '../lib/transactions';
import {
  buildDraft,
  buildReview,
  collectCorrections,
  ERROR_TYPES,
  fieldChanged,
  normalizeReviewImages,
} from '../lib/triageDraft';
import TriageCorrectionImages from './TriageCorrectionImages';
import {
  createClient,
  fetchLookupLocations,
  fetchLookupUsers,
  mergeEmployeeOptions,
  searchClients,
  searchProducts,
} from '../lib/triageLookups';

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
const STRUCK = '#8e8e93';
const MOBILE_BREAKPOINT = 768;
const DRAWER_OPEN_MS = 280;
const DRAWER_CLOSE_MS = 220;

function useHeldValue(value) {
  const held = useRef(value);
  if (value != null) held.current = value;
  return value ?? held.current;
}

function useRightDrawerAnimation(visible, slideDistance) {
  const [mounted, setMounted] = useState(visible);
  const slide = useRef(new Animated.Value(slideDistance)).current;
  const backdrop = useRef(new Animated.Value(0)).current;
  const slideDistanceRef = useRef(slideDistance);
  const activeAnim = useRef(null);
  slideDistanceRef.current = slideDistance;

  useEffect(() => {
    if (!mounted) slide.setValue(slideDistance);
  }, [slideDistance, mounted, slide]);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      return undefined;
    }
    if (!mounted) return undefined;

    const anim = Animated.parallel([
      Animated.timing(slide, {
        toValue: slideDistanceRef.current,
        duration: DRAWER_CLOSE_MS,
        easing: Easing.bezier(0.4, 0, 0.2, 1),
        useNativeDriver: true,
      }),
      Animated.timing(backdrop, {
        toValue: 0,
        duration: DRAWER_CLOSE_MS,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    ]);
    activeAnim.current = anim;
    anim.start(({ finished }) => {
      if (activeAnim.current === anim) activeAnim.current = null;
      if (finished) setMounted(false);
    });
    return () => {
      if (activeAnim.current === anim) {
        anim.stop();
        activeAnim.current = null;
      }
    };
  }, [visible, mounted, slide, backdrop]);

  useEffect(() => {
    if (!visible || !mounted) return undefined;
    slide.setValue(slideDistanceRef.current);
    backdrop.setValue(0);
    let cancelled = false;
    const raf = requestAnimationFrame(() => {
      if (cancelled) return;
      Animated.parallel([
        Animated.timing(slide, {
          toValue: 0,
          duration: DRAWER_OPEN_MS,
          easing: Easing.bezier(0.22, 1, 0.36, 1),
          useNativeDriver: true,
        }),
        Animated.timing(backdrop, {
          toValue: 1,
          duration: DRAWER_OPEN_MS,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
      ]).start();
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [visible, mounted, slide, backdrop]);

  return { mounted, slide, backdrop };
}

function CorrectionPair({ original, value }) {
  return (
    <View style={styles.correctionPair}>
      <Text style={styles.struckText}>{original || '—'}</Text>
      <Text style={styles.correctedText}>{value || '—'}</Text>
    </View>
  );
}

function CorrectableField({ label, field, onChange, compact, keyboardType, hideLabel }) {
  const changed = fieldChanged(field);
  return (
    <View style={[styles.fieldBlock, compact && styles.fieldBlockCompact]}>
      {label && !hideLabel ? <Text style={styles.fieldLabel}>{label}</Text> : null}
      {changed ? <Text style={styles.struckText}>{field.original || '—'}</Text> : null}
      <TextInput
        style={[styles.fieldInput, changed && styles.fieldInputCorrected, compact && styles.fieldInputCompact]}
        value={field.value}
        onChangeText={onChange}
        placeholder={field.original || '—'}
        placeholderTextColor="#c7c7cc"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType={keyboardType || 'default'}
      />
    </View>
  );
}

function LookupField({
  label,
  field,
  onChange,
  options,
  onSearch,
  allowCustom = false,
  pickOnly = false,
  placeholder,
  rightAction,
  hideLabel,
  compact,
}) {
  const changed = fieldChanged(field);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(field.value || '');
  const [remote, setRemote] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setQuery(field.value || '');
  }, [field.value]);

  const localResults = useMemo(() => {
    const list = options || [];
    const q = query.trim().toLowerCase();
    if (!q) return list.slice(0, 40);
    return list
      .filter(
        (option) =>
          String(option.label || '').toLowerCase().includes(q) ||
          String(option.sub || '').toLowerCase().includes(q),
      )
      .slice(0, 40);
  }, [options, query]);

  useEffect(() => {
    if (!onSearch || !open) return;
    const q = query.trim();
    if (q.length < 2) {
      setRemote([]);
      setBusy(false);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setBusy(true);
      try {
        const next = await onSearch(q);
        if (!cancelled) setRemote(next);
      } catch {
        if (!cancelled) setRemote([]);
      } finally {
        if (!cancelled) setBusy(false);
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [onSearch, query, open]);

  const results = onSearch ? remote : localResults;
  const showCustom =
    allowCustom &&
    query.trim() &&
    !results.some((option) => String(option.label || '').toLowerCase() === query.trim().toLowerCase());

  const select = (option) => {
    onChange(option.label, option);
    setQuery(option.label);
    setOpen(false);
  };

  const commitTyped = () => {
    if (pickOnly) {
      const match = (options || []).find(
        (option) => option.label.toLowerCase() === query.trim().toLowerCase(),
      );
      if (match) select(match);
      else setQuery(field.value || '');
      return;
    }
    if (allowCustom && query.trim()) {
      onChange(query.trim(), { id: 'custom', label: query.trim(), custom: true });
    }
  };

  return (
    <View style={[styles.fieldBlock, styles.lookupBlock, compact && styles.fieldBlockCompact]}>
      {label && !hideLabel ? <Text style={styles.fieldLabel}>{label}</Text> : null}
      {changed ? <Text style={styles.struckText}>{field.original || '—'}</Text> : null}
      <View style={styles.lookupRow}>
        <View style={styles.lookupInputWrap}>
          <TextInput
            style={[styles.fieldInput, changed && styles.fieldInputCorrected, compact && styles.fieldInputCompact]}
            value={query}
            onChangeText={(value) => {
              setQuery(value);
              setOpen(true);
              if (!pickOnly && !onSearch) onChange(value);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => {
              setTimeout(() => {
                setOpen(false);
                commitTyped();
              }, 160);
            }}
            placeholder={placeholder || field.original || 'Search'}
            placeholderTextColor="#c7c7cc"
            autoCapitalize="none"
            autoCorrect={false}
          />
          {busy ? <ActivityIndicator size="small" color={SECONDARY} style={styles.lookupSpinner} /> : null}
        </View>
        {rightAction}
      </View>
      {open ? (
        <ScrollView style={styles.lookupMenu} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
          {showCustom ? (
            <Pressable
              style={styles.lookupOption}
              onPress={() => select({ id: 'custom', label: query.trim(), custom: true })}
            >
              <Text style={styles.lookupOptionLabel}>Use “{query.trim()}”</Text>
              <Text style={styles.lookupOptionSub}>Custom product</Text>
            </Pressable>
          ) : null}
          {results.length === 0 && !busy ? (
            <Text style={styles.lookupEmpty}>
              {onSearch && query.trim().length < 2
                ? 'Type at least 2 characters'
                : pickOnly
                  ? 'No matching value'
                  : 'No matches'}
            </Text>
          ) : (
            results.map((option) => (
              <Pressable
                key={`${option.id}-${option.label}`}
                style={styles.lookupOption}
                onPress={() => select(option)}
              >
                <Text style={styles.lookupOptionLabel} numberOfLines={1}>
                  {option.label}
                </Text>
                {option.sub ? (
                  <Text style={styles.lookupOptionSub} numberOfLines={1}>
                    {option.sub}
                  </Text>
                ) : null}
              </Pressable>
            ))
          )}
        </ScrollView>
      ) : null}
    </View>
  );
}

function NewCustomerPanel({ onCancel, onCreated, token, baseUrl }) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      const created = await createClient(token, { firstName, lastName, email, phone }, baseUrl);
      onCreated(created);
    } catch (err) {
      setError(err?.message || 'Could not add customer.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.newCustomerCard}>
      <Text style={styles.sectionLabel}>New customer</Text>
      <View style={styles.itemRow}>
        <View style={styles.fieldBlockCompact}>
          <Text style={styles.fieldLabel}>First name</Text>
          <TextInput
            style={styles.fieldInput}
            value={firstName}
            onChangeText={setFirstName}
            placeholder="First"
            placeholderTextColor="#c7c7cc"
          />
        </View>
        <View style={styles.fieldBlockCompact}>
          <Text style={styles.fieldLabel}>Last name</Text>
          <TextInput
            style={styles.fieldInput}
            value={lastName}
            onChangeText={setLastName}
            placeholder="Last"
            placeholderTextColor="#c7c7cc"
          />
        </View>
      </View>
      <Text style={styles.fieldLabel}>Email</Text>
      <TextInput
        style={styles.fieldInput}
        value={email}
        onChangeText={setEmail}
        placeholder="name@email.com"
        placeholderTextColor="#c7c7cc"
        autoCapitalize="none"
        keyboardType="email-address"
      />
      <Text style={styles.fieldLabel}>Phone</Text>
      <TextInput
        style={styles.fieldInput}
        value={phone}
        onChangeText={setPhone}
        placeholder="Optional"
        placeholderTextColor="#c7c7cc"
        keyboardType="phone-pad"
      />
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      <View style={styles.newCustomerActions}>
        <Pressable style={styles.secondaryButton} onPress={onCancel}>
          <Text style={styles.secondaryButtonText}>Cancel</Text>
        </Pressable>
        <Pressable
          style={[styles.primaryButton, styles.primaryButtonInline, busy && styles.primaryButtonDisabled]}
          onPress={save}
          disabled={busy}
        >
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>Add customer</Text>}
        </Pressable>
      </View>
    </View>
  );
}

export default function TriageReviewDrawer({ visible, session, row, review, extraRows = [], onClose, onSave }) {
  const { width: windowWidth } = useWindowDimensions();
  const isMobile = windowWidth < MOBILE_BREAKPOINT;
  const panelWidth = isMobile
    ? Math.max(windowWidth, 240)
    : Math.min(Math.max(Math.round(windowWidth * 0.56), 520), Math.round(windowWidth - 64));
  const { mounted, slide, backdrop } = useRightDrawerAnimation(visible, panelWidth);
  const heldRow = useHeldValue(row);

  const [step, setStep] = useState('edit');
  const [activeRow, setActiveRow] = useState(null);
  const [draft, setDraft] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [note, setNote] = useState('');
  const [errorType, setErrorType] = useState('');
  const [errorAmount, setErrorAmount] = useState('');
  const [images, setImages] = useState([]);
  const [locations, setLocations] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [addingCustomer, setAddingCustomer] = useState(false);
  const detailRequestId = useRef(0);

  const reset = useCallback(() => {
    setStep('edit');
    setActiveRow(null);
    setDraft(null);
    setDetailError('');
    setDetailLoading(false);
    setNote('');
    setErrorType('');
    setErrorAmount('');
    setImages([]);
    setAddingCustomer(false);
  }, []);

  useEffect(() => {
    if (!visible || !row) {
      reset();
      return;
    }

    setActiveRow(row);
    setAddingCustomer(false);
    setStep('edit');
    const id = ++detailRequestId.current;
    if (review?.draft) {
      setDraft(review.draft);
      setNote(review.note || '');
      setErrorType(review.errorType || '');
      setErrorAmount(String(review.errorAmount || '').replace(/^\$/, ''));
      setImages(normalizeReviewImages(review.images));
      setDetailLoading(false);
      setDetailError('');
      return;
    }

    setDraft(buildDraft(row, null));
    setNote('');
    setErrorType('');
    setErrorAmount('');
    setImages([]);
    setDetailLoading(true);
    setDetailError('');

    const auth = resolvePosAuthForRow(session, row);
    fetchTransactionDetail(auth.token, {
      type: row.type,
      sourceId: row.sourceId,
      baseUrl: auth.baseUrl,
    })
      .then((detail) => {
        if (id !== detailRequestId.current) return;
        const enriched = withLineItems(row, detail);
        setActiveRow(enriched);
        setDraft(buildDraft(enriched, detail));
      })
      .catch((err) => {
        if (id !== detailRequestId.current) return;
        setDetailError(err?.message || 'Could not load full document. You can still edit the summary.');
      })
      .finally(() => {
        if (id === detailRequestId.current) setDetailLoading(false);
      });
  }, [reset, review, row, session, visible]);

  useEffect(() => {
    if (!visible || !session || !activeRow) return;
    const auth = resolvePosAuthForRow(session, activeRow);
    let cancelled = false;
    (async () => {
      const [locs, users] = await Promise.all([
        fetchLookupLocations(auth.token, auth.baseUrl).catch(() => []),
        fetchLookupUsers(auth.token, auth.baseUrl).catch(() => []),
      ]);
      if (cancelled) return;
      const storeName = String(activeRow?.storeName || '').trim();
      setLocations(
        storeName && storeName !== '—' && !locs.some((entry) => entry.label === storeName)
          ? [{ id: 'current', label: storeName, sub: 'Current store' }, ...locs]
          : locs,
      );
      setEmployees(mergeEmployeeOptions(users, [activeRow, ...extraRows]));
    })();
    return () => {
      cancelled = true;
    };
  }, [activeRow, extraRows, session, visible]);

  const searchCustomerOptions = useCallback(
    async (query) => {
      if (!session || !activeRow) return [];
      const auth = resolvePosAuthForRow(session, activeRow);
      return searchClients(auth.token, query, auth.baseUrl);
    },
    [activeRow, session],
  );

  const searchProductOptions = useCallback(
    async (query) => {
      if (!session || !activeRow) return [];
      const auth = resolvePosAuthForRow(session, activeRow);
      return searchProducts(auth.token, query, auth.baseUrl);
    },
    [activeRow, session],
  );

  const headerField = (key) => (draft?.header || []).find((field) => field.key === key);
  const corrections = useMemo(() => collectCorrections(draft), [draft]);
  const auth = activeRow ? resolvePosAuthForRow(session, activeRow) : {};

  const updateHeader = (key, value) => {
    setDraft((current) => ({
      ...current,
      header: current.header.map((field) => (field.key === key ? { ...field, value } : field)),
    }));
  };

  const updateItem = (id, part, value) => {
    setDraft((current) => ({
      ...current,
      items: current.items.map((item) =>
        item.id === id ? { ...item, [part]: { ...item[part], value } } : item,
      ),
    }));
  };

  const updatePayment = (id, part, value) => {
    setDraft((current) => ({
      ...current,
      payments: current.payments.map((payment) =>
        payment.id === id ? { ...payment, [part]: { ...payment[part], value } } : payment,
      ),
    }));
  };

  const finish = () => {
    if (!activeRow || !draft) return;
    onSave?.(activeRow.id, buildReview(activeRow, draft, { note, errorType, errorAmount, images }));
    onClose?.();
  };

  if (!mounted || !heldRow) return null;

  const title = step === 'note' ? 'Describe the error' : heldRow.reference || 'Purchase order';

  return (
    <Modal visible={mounted} transparent animationType="none" onRequestClose={onClose}>
      <View style={styles.drawerRoot}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose}>
          <Animated.View style={[styles.drawerBackdrop, { opacity: backdrop }]} />
        </Pressable>

        <Animated.View
          style={[
            styles.drawerPanel,
            isMobile && styles.drawerPanelMobile,
            { width: panelWidth, transform: [{ translateX: slide }] },
          ]}
        >
          <View
            style={[styles.drawerTopBar, isMobile && styles.drawerTopBarMobile]}
            {...(Platform.OS === 'web' && isMobile ? { className: 'cgold-mobile-sheet-top' } : null)}
          >
            <View style={styles.titleBlock}>
              {step === 'note' ? (
                <Pressable onPress={() => setStep('edit')} style={styles.backRow} hitSlop={8}>
                  <Ionicons name="chevron-back" size={18} color={ACCENT} />
                  <Text style={styles.backText}>Back</Text>
                </Pressable>
              ) : null}
              <Text style={styles.drawerTitle} numberOfLines={1}>
                {title}
              </Text>
              <Text style={styles.drawerSub}>
                {step === 'note'
                  ? 'Add a note, photos, the type of error, and the dollar amount, then finish.'
                  : 'Edit any field. The original stays struck through with the correction under it.'}
              </Text>
            </View>
            <Pressable onPress={onClose} hitSlop={8} style={styles.closeButton} accessibilityLabel="Close">
              <Ionicons name="close" size={18} color={TEXT} />
            </Pressable>
          </View>

          {step === 'edit' ? (
            <>
              {detailLoading ? (
                <View style={styles.inlineBusy}>
                  <ActivityIndicator color={ACCENT} />
                  <Text style={styles.metaText}>Loading document…</Text>
                </View>
              ) : null}
              {detailError ? <Text style={styles.warnText}>{detailError}</Text> : null}

              <ScrollView
                style={styles.body}
                contentContainerStyle={styles.editContent}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                {headerField('customer') ? (
                  addingCustomer ? (
                    <NewCustomerPanel
                      token={auth.token}
                      baseUrl={auth.baseUrl}
                      onCancel={() => setAddingCustomer(false)}
                      onCreated={(created) => {
                        updateHeader('customer', created.label);
                        setAddingCustomer(false);
                      }}
                    />
                  ) : (
                    <LookupField
                      label={headerField('customer').label}
                      field={headerField('customer')}
                      onSearch={searchCustomerOptions}
                      onChange={(value) => updateHeader('customer', value)}
                      placeholder="Search customers"
                      rightAction={
                        <Pressable
                          style={styles.newSideButton}
                          onPress={() => setAddingCustomer(true)}
                          accessibilityLabel="New customer"
                        >
                          <Ionicons name="add" size={16} color="#fff" />
                          <Text style={styles.newSideButtonText}>New</Text>
                        </Pressable>
                      }
                    />
                  )
                ) : null}

                {headerField('store') ? (
                  <LookupField
                    label="Store"
                    field={headerField('store')}
                    options={locations}
                    pickOnly
                    onChange={(value) => updateHeader('store', value)}
                    placeholder="Select a store"
                  />
                ) : null}

                {headerField('employee') ? (
                  <LookupField
                    label="Employee"
                    field={headerField('employee')}
                    options={employees}
                    pickOnly
                    onChange={(value) => updateHeader('employee', value)}
                    placeholder="Select an employee"
                  />
                ) : null}

                {headerField('date') ? (
                  <CorrectableField
                    label="Date"
                    field={headerField('date')}
                    onChange={(value) => updateHeader('date', value)}
                  />
                ) : null}

                {headerField('total') ? (
                  <CorrectableField
                    label="Total"
                    field={headerField('total')}
                    onChange={(value) => updateHeader('total', value)}
                  />
                ) : null}

                <Text style={styles.sectionLabel}>Line items</Text>
                {(draft?.items || []).length === 0 ? (
                  <Text style={styles.emptyText}>No line items</Text>
                ) : isMobile ? (
                  <View style={styles.mobileItemList}>
                    {draft.items.map((item, index) => (
                      <View key={item.id} style={styles.itemCard}>
                        <Text style={styles.itemIndex}>Item {index + 1}</Text>
                        <LookupField
                          label="Product"
                          field={item.name}
                          onSearch={searchProductOptions}
                          allowCustom
                          onChange={(value) => updateItem(item.id, 'name', value)}
                          placeholder="Search product or type custom"
                        />
                        <View style={styles.mobileItemRow}>
                          <View style={styles.mobileItemField}>
                            <CorrectableField
                              label="Qty"
                              field={item.qty}
                              onChange={(value) => updateItem(item.id, 'qty', value)}
                            />
                          </View>
                          <View style={styles.mobileItemField}>
                            <CorrectableField
                              label="Unit"
                              field={item.unit}
                              onChange={(value) => updateItem(item.id, 'unit', value)}
                            />
                          </View>
                        </View>
                        <CorrectableField
                          label="Amount"
                          field={item.amount}
                          onChange={(value) => updateItem(item.id, 'amount', value)}
                        />
                      </View>
                    ))}
                  </View>
                ) : (
                  <View style={styles.lineTable}>
                    <View
                      style={styles.lineTableHeader}
                      {...(Platform.OS === 'web' ? { className: 'cgold-triage-line-grid' } : null)}
                    >
                      <View style={styles.lineColProduct}>
                        <Text style={styles.lineTh}>Product</Text>
                      </View>
                      <View style={styles.lineColQty}>
                        <Text style={styles.lineTh}>Qty</Text>
                      </View>
                      <View style={styles.lineColUnit}>
                        <Text style={[styles.lineTh, styles.colAmountText]}>Unit</Text>
                      </View>
                      <View style={styles.lineColAmount}>
                        <Text style={[styles.lineTh, styles.colAmountText]}>Amount</Text>
                      </View>
                    </View>
                    {draft.items.map((item) => (
                      <View
                        key={item.id}
                        style={styles.lineTableRow}
                        {...(Platform.OS === 'web' ? { className: 'cgold-triage-line-grid' } : null)}
                      >
                        <View style={styles.lineColProduct}>
                          <LookupField
                            hideLabel
                            compact
                            field={item.name}
                            onSearch={searchProductOptions}
                            allowCustom
                            onChange={(value) => updateItem(item.id, 'name', value)}
                            placeholder="Search product or type custom"
                          />
                        </View>
                        <View style={styles.lineColQty}>
                          <CorrectableField
                            hideLabel
                            compact
                            field={item.qty}
                            onChange={(value) => updateItem(item.id, 'qty', value)}
                          />
                        </View>
                        <View style={styles.lineColUnit}>
                          <CorrectableField
                            hideLabel
                            compact
                            field={item.unit}
                            onChange={(value) => updateItem(item.id, 'unit', value)}
                          />
                        </View>
                        <View style={styles.lineColAmount}>
                          <CorrectableField
                            hideLabel
                            compact
                            field={item.amount}
                            onChange={(value) => updateItem(item.id, 'amount', value)}
                          />
                        </View>
                      </View>
                    ))}
                  </View>
                )}

                {(draft?.payments || []).length > 0 ? (
                  <>
                    <Text style={styles.sectionLabel}>Payments</Text>
                    {draft.payments.map((payment, index) => (
                      <View key={payment.id} style={styles.itemCard}>
                        <Text style={styles.itemIndex}>Payment {index + 1}</Text>
                        <CorrectableField
                          label="Method"
                          field={payment.method}
                          onChange={(value) => updatePayment(payment.id, 'method', value)}
                        />
                        <CorrectableField
                          label="Amount"
                          field={payment.amount}
                          onChange={(value) => updatePayment(payment.id, 'amount', value)}
                        />
                      </View>
                    ))}
                  </>
                ) : null}
              </ScrollView>

              <Pressable style={styles.primaryButton} onPress={() => setStep('note')}>
                <Text style={styles.primaryButtonText}>Next</Text>
              </Pressable>
            </>
          ) : (
            <ScrollView
              style={styles.body}
              contentContainerStyle={styles.editContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <Text style={styles.sectionLabel}>Corrections</Text>
              {corrections.length === 0 ? (
                <Text style={styles.emptyText}>No field corrections</Text>
              ) : (
                <View style={styles.correctionList}>
                  {corrections.map((correction) => (
                    <View key={correction.key} style={styles.correctionItem}>
                      <Text style={styles.fieldLabel}>{correction.label}</Text>
                      <CorrectionPair original={correction.original} value={correction.value} />
                    </View>
                  ))}
                </View>
              )}

              <Text style={styles.fieldLabel}>Note</Text>
              <TextInput
                style={[styles.fieldInput, styles.noteInput]}
                value={note}
                onChangeText={setNote}
                placeholder="Describe the error"
                placeholderTextColor="#c7c7cc"
                multiline
                textAlignVertical="top"
              />

              <TriageCorrectionImages images={images} onChange={setImages} compact={isMobile} />

              <Text style={styles.fieldLabel}>Type of error</Text>
              <TextInput
                style={styles.fieldInput}
                value={errorType}
                onChangeText={setErrorType}
                placeholder="Describe the type of error"
                placeholderTextColor="#c7c7cc"
                autoCapitalize="sentences"
              />
              <View style={styles.typeChips}>
                {ERROR_TYPES.map((type) => {
                  const active = errorType === type;
                  return (
                    <Pressable
                      key={type}
                      style={[styles.typeChip, active && styles.typeChipActive]}
                      onPress={() => setErrorType(type)}
                    >
                      <Text style={[styles.typeChipText, active && styles.typeChipTextActive]}>{type}</Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text style={styles.fieldLabel}>Amount</Text>
              <View style={styles.amountBox}>
                <Text style={styles.amountPrefix}>$</Text>
                <TextInput
                  style={styles.amountInput}
                  value={errorAmount.replace(/^\$/, '')}
                  onChangeText={(value) => setErrorAmount(value.replace(/[^0-9.]/g, ''))}
                  placeholder="0.00"
                  placeholderTextColor="#c7c7cc"
                  keyboardType="decimal-pad"
                />
              </View>

              <Pressable style={styles.primaryButton} onPress={finish}>
                <Text style={styles.primaryButtonText}>Finish</Text>
              </Pressable>
            </ScrollView>
          )}
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  drawerRoot: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  drawerBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.28)',
  },
  drawerPanel: {
    height: '100%',
    backgroundColor: '#fff',
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 16,
    gap: 10,
    ...Platform.select({
      web: { boxShadow: '-12px 0 32px rgba(0,0,0,0.18)' },
      default: { elevation: 12 },
    }),
  },
  drawerPanelMobile: {
    paddingHorizontal: 14,
    paddingBottom: Platform.OS === 'ios' ? 28 : 14,
  },
  drawerTopBar: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  drawerTopBarMobile: {
    paddingTop: Platform.OS === 'ios' ? 38 : 2,
  },
  titleBlock: {
    flex: 1,
    minWidth: 0,
  },
  backRow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    marginBottom: 4,
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
  drawerTitle: {
    fontFamily,
    fontSize: 18,
    fontWeight: '600',
    color: TEXT,
    letterSpacing: -0.3,
  },
  drawerSub: {
    fontFamily,
    fontSize: 13,
    lineHeight: 18,
    color: SECONDARY,
    marginTop: 4,
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: FILL,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  body: {
    flex: 1,
    minHeight: 0,
  },
  editContent: {
    gap: 10,
    paddingBottom: 16,
  },
  inlineBusy: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  metaText: {
    fontFamily,
    fontSize: 13,
    color: SECONDARY,
  },
  warnText: {
    fontFamily,
    fontSize: 13,
    color: ACCENT,
  },
  errorText: {
    fontFamily,
    fontSize: 13,
    color: ACCENT,
  },
  emptyText: {
    fontFamily,
    fontSize: 14,
    color: SECONDARY,
    paddingVertical: 8,
  },
  sectionLabel: {
    fontFamily,
    fontSize: 12,
    fontWeight: '600',
    color: SECONDARY,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginTop: 6,
  },
  fieldBlock: {
    gap: 4,
  },
  fieldBlockCompact: {
    flex: 1,
    minWidth: 0,
  },
  fieldLabel: {
    fontFamily,
    fontSize: 12,
    fontWeight: '600',
    color: SECONDARY,
  },
  fieldInput: {
    fontFamily,
    fontSize: 16,
    color: TEXT,
    backgroundColor: FILL,
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    outlineStyle: 'none',
  },
  fieldInputCorrected: {
    backgroundColor: '#FFF7ED',
    color: ACCENT,
    fontWeight: '600',
  },
  fieldInputCompact: {
    minWidth: 0,
    width: '100%',
    paddingVertical: 8,
    paddingHorizontal: 10,
    fontSize: 15,
  },
  lookupBlock: {
    zIndex: 4,
  },
  lookupRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  lookupInputWrap: {
    flex: 1,
    minWidth: 0,
    position: 'relative',
  },
  lookupSpinner: {
    position: 'absolute',
    right: 10,
    top: 12,
  },
  lookupMenu: {
    marginTop: 4,
    backgroundColor: '#fff',
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: HAIRLINE,
    maxHeight: 220,
    overflow: 'hidden',
    zIndex: 8,
    ...Platform.select({
      web: { boxShadow: '0 8px 20px rgba(0,0,0,0.08)' },
      default: { elevation: 3 },
    }),
  },
  lookupOption: {
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: HAIRLINE,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  lookupOptionLabel: {
    fontFamily,
    fontSize: 15,
    color: TEXT,
  },
  lookupOptionSub: {
    fontFamily,
    fontSize: 12,
    color: SECONDARY,
    marginTop: 1,
  },
  lookupEmpty: {
    fontFamily,
    fontSize: 13,
    color: SECONDARY,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  newSideButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: ACCENT,
    borderRadius: 6,
    paddingHorizontal: 10,
    height: 42,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  newSideButtonText: {
    fontFamily,
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
  newCustomerCard: {
    backgroundColor: '#f5f5f7',
    borderRadius: 6,
    padding: 12,
    gap: 8,
  },
  newCustomerActions: {
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
  primaryButtonText: {
    fontFamily,
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  struckText: {
    fontFamily,
    fontSize: 14,
    color: STRUCK,
    textDecorationLine: 'line-through',
  },
  correctedText: {
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: ACCENT,
  },
  correctionPair: {
    gap: 2,
  },
  correctionList: {
    gap: 8,
  },
  correctionItem: {
    gap: 2,
  },
  lineTable: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: HAIRLINE,
    borderRadius: 6,
    overflow: 'visible',
    backgroundColor: '#fff',
  },
  lineTableHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    minHeight: 36,
    paddingHorizontal: 10,
    backgroundColor: '#ebebf0',
    borderTopLeftRadius: 6,
    borderTopRightRadius: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#d1d1d6',
  },
  lineTh: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: SECONDARY,
    letterSpacing: -0.08,
  },
  lineTableRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    width: '100%',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: HAIRLINE,
  },
  lineColProduct: {
    flex: 1,
    minWidth: 0,
    paddingRight: 10,
  },
  lineColQty: {
    width: 72,
    flexGrow: 0,
    flexShrink: 0,
    paddingRight: 8,
  },
  lineColUnit: {
    width: 88,
    flexGrow: 0,
    flexShrink: 0,
    paddingRight: 8,
  },
  lineColAmount: {
    width: 100,
    flexGrow: 0,
    flexShrink: 0,
  },
  colAmountText: {
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  mobileItemList: {
    gap: 10,
  },
  mobileItemRow: {
    flexDirection: 'row',
    gap: 8,
  },
  mobileItemField: {
    flex: 1,
    minWidth: 0,
  },
  itemCard: {
    backgroundColor: '#f5f5f7',
    borderRadius: 6,
    padding: 10,
    gap: 8,
    overflow: 'visible',
    zIndex: 2,
  },
  itemIndex: {
    fontFamily,
    fontSize: 12,
    fontWeight: '600',
    color: SECONDARY,
  },
  itemRow: {
    flexDirection: 'row',
    gap: 8,
  },
  noteInput: {
    minHeight: 110,
    paddingTop: 10,
  },
  typeChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  typeChip: {
    backgroundColor: FILL,
    borderRadius: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  typeChipActive: {
    backgroundColor: '#FFEDD5',
  },
  typeChipText: {
    fontFamily,
    fontSize: 13,
    color: '#6b6b6b',
  },
  typeChipTextActive: {
    color: ACCENT,
    fontWeight: '600',
  },
  amountBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: FILL,
    borderRadius: 6,
    paddingHorizontal: 12,
    minHeight: 46,
  },
  amountPrefix: {
    fontFamily,
    fontSize: 18,
    fontWeight: '600',
    color: TEXT,
    marginRight: 6,
  },
  amountInput: {
    flex: 1,
    fontFamily,
    fontSize: 18,
    fontWeight: '600',
    color: TEXT,
    paddingVertical: 10,
    outlineStyle: 'none',
  },
});
