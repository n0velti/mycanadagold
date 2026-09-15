import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
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
  isWeightUnit,
  MAX_REVIEW_IMAGES,
  normalizeDraft,
  normalizeReviewImages,
} from '../lib/triageDraft';
import TriageCorrectionImages from './TriageCorrectionImages';
import { FONT, T, TextAction, TriageDrawer, useHeldValue } from './TriageKit';
import { useIsMobile } from '../lib/mobileUi';
import {
  fetchLookupLocations,
  fetchLookupUsers,
  mergeEmployeeOptions,
  searchClients,
  searchProducts,
} from '../lib/triageLookups';
import { catalogProductOptions, fetchWebsitePrices, filterCatalogProductOptions } from '../lib/websitePrices';

const fontFamily = FONT;
const TEXT = T.text;
const SECONDARY = T.secondary;
const HAIRLINE = T.hairline;
const STRUCK = T.secondary;
const MOBILE_BREAKPOINT = 768;

function CorrectionPair({ original, value }) {
  return (
    <View style={styles.correctionPair}>
      <Text style={styles.struckText}>{original || '—'}</Text>
      <Text style={styles.correctedText}>{value || '—'}</Text>
    </View>
  );
}

function ReverseButton({ onPress }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      style={styles.reverseButton}
      accessibilityRole="button"
      accessibilityLabel="Revert change"
    >
      <Text style={styles.reverseButtonText}>Revert</Text>
    </Pressable>
  );
}

function ChangedOriginal({ field, onReverse }) {
  if (!fieldChanged(field)) return null;
  return (
    <View style={styles.changedRow}>
      <Text style={[styles.struckText, styles.changedOriginal]} numberOfLines={1}>
        {field.original || '—'}
      </Text>
      <ReverseButton onPress={onReverse} />
    </View>
  );
}

function CorrectableField({ label, field, onChange, keyboardType, last, suffix }) {
  const stacked = useIsMobile();
  const changed = fieldChanged(field);
  const reverse = () => onChange(field.original ?? '');
  return (
    <View style={[styles.iosRowWrap, last && styles.iosRowLast]}>
      <View style={[styles.iosRow, stacked && styles.iosRowStacked]}>
        {label ? <Text style={[styles.iosRowLabel, stacked && styles.iosRowLabelStacked]}>{label}</Text> : null}
        <View style={styles.iosRowControl}>
          <ChangedOriginal field={field} onReverse={reverse} />
          <View style={styles.valueRow}>
            <TextInput
              style={[styles.iosRowInput, stacked && styles.iosRowInputStacked, changed && styles.iosRowInputChanged]}
              value={field.value}
              onChangeText={onChange}
              placeholder="Edit"
              placeholderTextColor="#c7c7cc"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType={keyboardType || 'default'}
            />
            {suffix ? <Text style={styles.unitLock}>{suffix}</Text> : null}
          </View>
        </View>
      </View>
    </View>
  );
}

function LookupField({
  label,
  field,
  onChange,
  options,
  filterOptions,
  onSearch,
  allowCustom = false,
  pickOnly = false,
  placeholder,
  rightAction,
  last,
}) {
  const stacked = useIsMobile();
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
    if (filterOptions) return filterOptions(list, query);
    const q = query.trim().toLowerCase();
    if (!q) return list.slice(0, 40);
    return list
      .filter(
        (option) =>
          String(option.label || '').toLowerCase().includes(q) ||
          String(option.sub || '').toLowerCase().includes(q),
      )
      .slice(0, 40);
  }, [filterOptions, options, query]);

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

  const results = useMemo(() => {
    const seen = new Set();
    const merged = [];
    for (const option of [...localResults, ...(onSearch ? remote : [])]) {
      const key = String(option?.label || '')
        .trim()
        .toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      merged.push(option);
    }
    return merged.slice(0, 40);
  }, [localResults, onSearch, remote]);
  const showCustom =
    allowCustom &&
    query.trim() &&
    !results.some((option) => String(option.label || '').toLowerCase() === query.trim().toLowerCase());

  const picking = useRef(false);

  const select = (option) => {
    const label = String(option?.label || '').trim();
    if (!label) return;
    picking.current = true;
    onChange(label, option);
    setQuery(label);
    setOpen(false);
    setTimeout(() => {
      picking.current = false;
    }, 400);
  };

  const commitTyped = () => {
    if (picking.current) return;
    const q = query.trim();
    const pool = [...(results || []), ...(options || [])];
    const exact = pool.find(
      (option) => String(option.label || '').toLowerCase() === q.toLowerCase(),
    );
    if (pickOnly) {
      if (exact) {
        select(exact);
        return;
      }
      if (q && results.length === 1) {
        select(results[0]);
        return;
      }
      setQuery(field.value || '');
      return;
    }
    if (exact) {
      select(exact);
      return;
    }
    if (q && (allowCustom || onSearch)) {
      onChange(q, { id: 'custom', label: q, custom: true });
    }
  };

  const reverse = () => {
    const original = field.original ?? '';
    onChange(original);
    setQuery(original);
    setOpen(false);
  };

  return (
    <View style={[styles.iosRowWrap, last && styles.iosRowLast, styles.lookupBlock]}>
      <View style={[styles.iosRow, stacked && styles.iosRowStacked]}>
        {label ? <Text style={[styles.iosRowLabel, stacked && styles.iosRowLabelStacked]}>{label}</Text> : null}
        <View style={styles.iosRowControl}>
          <ChangedOriginal field={field} onReverse={reverse} />
          <View style={styles.lookupRow}>
            <View style={styles.lookupInputWrap}>
              <TextInput
                style={[styles.iosRowInput, stacked && styles.iosRowInputStacked, changed && styles.iosRowInputChanged]}
                value={query}
                onChangeText={(value) => {
                  setQuery(value);
                  setOpen(true);
                  if (!pickOnly && !onSearch) onChange(value);
                }}
                onFocus={() => setOpen(true)}
                onBlur={() => {
                  setTimeout(() => {
                    commitTyped();
                    if (!picking.current) setOpen(false);
                  }, 180);
                }}
                placeholder={placeholder || 'Edit'}
                placeholderTextColor="#c7c7cc"
                autoCapitalize="none"
                autoCorrect={false}
              />
              {busy ? <ActivityIndicator size="small" color={SECONDARY} style={styles.lookupSpinner} /> : null}
            </View>
            <Ionicons name="chevron-forward" size={16} color="#c7c7cc" />
            {rightAction}
          </View>
        </View>
      </View>
      {open ? (
        <ScrollView style={styles.lookupMenu} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
          {showCustom ? (
            <Pressable
              style={styles.lookupOption}
              onPress={() => select({ id: 'custom', label: query.trim(), custom: true })}
              onPressIn={() => select({ id: 'custom', label: query.trim(), custom: true })}
              {...(Platform.OS === 'web'
                ? {
                    onMouseDown: (event) => {
                      event?.preventDefault?.();
                    },
                  }
                : null)}
            >
              <Text style={styles.lookupOptionLabel}>Use “{query.trim()}”</Text>
              <Text style={styles.lookupOptionSub}>Custom product</Text>
            </Pressable>
          ) : null}
          {results.length === 0 && !busy ? (
            <Text style={styles.lookupEmpty}>
              {onSearch && query.trim().length < 2 && localResults.length === 0
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
                onPressIn={() => select(option)}
                {...(Platform.OS === 'web'
                  ? {
                      onMouseDown: (event) => {
                        event?.preventDefault?.();
                      },
                    }
                  : null)}
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

function NewCustomerPanel({ onCancel, onCreated }) {
  const stacked = useIsMobile();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState('');

  const save = () => {
    const first = firstName.trim();
    const last = lastName.trim();
    const label = [first, last].filter(Boolean).join(' ');
    if (!label) {
      setError('Enter a customer name.');
      return;
    }
    onCreated({
      id: `local-${Date.now()}`,
      label,
      firstName: first,
      lastName: last,
      email: email.trim(),
      phone: phone.trim(),
    });
  };

  return (
    <View style={styles.newCustomerCard}>
      <Text style={styles.groupHeader}>New customer</Text>
      <View style={styles.group}>
        <View style={[styles.iosRow, stacked && styles.iosRowStacked]}>
          <Text style={[styles.iosRowLabel, stacked && styles.iosRowLabelStacked]}>First</Text>
          <TextInput
            style={[styles.iosRowInput, stacked && styles.iosRowInputStacked]}
            value={firstName}
            onChangeText={setFirstName}
            placeholder="First name"
            placeholderTextColor="#c7c7cc"
          />
        </View>
        <View style={[styles.iosRow, stacked && styles.iosRowStacked]}>
          <Text style={[styles.iosRowLabel, stacked && styles.iosRowLabelStacked]}>Last</Text>
          <TextInput
            style={[styles.iosRowInput, stacked && styles.iosRowInputStacked]}
            value={lastName}
            onChangeText={setLastName}
            placeholder="Last name"
            placeholderTextColor="#c7c7cc"
          />
        </View>
        <View style={[styles.iosRow, stacked && styles.iosRowStacked]}>
          <Text style={[styles.iosRowLabel, stacked && styles.iosRowLabelStacked]}>Email</Text>
          <TextInput
            style={[styles.iosRowInput, stacked && styles.iosRowInputStacked]}
            value={email}
            onChangeText={setEmail}
            placeholder="name@email.com"
            placeholderTextColor="#c7c7cc"
            autoCapitalize="none"
            keyboardType="email-address"
          />
        </View>
        <View style={[styles.iosRow, styles.iosRowLast, stacked && styles.iosRowStacked]}>
          <Text style={[styles.iosRowLabel, stacked && styles.iosRowLabelStacked]}>Phone</Text>
          <TextInput
            style={[styles.iosRowInput, stacked && styles.iosRowInputStacked]}
            value={phone}
            onChangeText={setPhone}
            placeholder="Optional"
            placeholderTextColor="#c7c7cc"
            keyboardType="phone-pad"
          />
        </View>
      </View>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      <View style={styles.newCustomerActions}>
        <TextAction label="Cancel" onPress={onCancel} accessibilityLabel="Cancel new customer" />
        <TextAction label="Add" strong onPress={save} accessibilityLabel="Add customer" />
      </View>
    </View>
  );
}

export default function TriageReviewDrawer({ visible, session, row, review, extraRows = [], onClose, onSave, onHydrate }) {
  const { width: windowWidth } = useWindowDimensions();
  const isMobile = windowWidth < MOBILE_BREAKPOINT;
  const heldRow = useHeldValue(row);
  const [mounted, setMounted] = useState(visible);

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
  const [pricingOptions, setPricingOptions] = useState([]);
  const [addingCustomer, setAddingCustomer] = useState(false);
  const imagesRef = useRef(null);
  const detailRequestId = useRef(0);
  const openedIdRef = useRef(null);
  const rowRef = useRef(row);
  const reviewRef = useRef(review);
  const sessionRef = useRef(session);
  const onHydrateRef = useRef(onHydrate);
  rowRef.current = row;
  reviewRef.current = review;
  sessionRef.current = session;
  onHydrateRef.current = onHydrate;

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
    if (visible) {
      setMounted(true);
      return undefined;
    }
    openedIdRef.current = null;
    const timer = setTimeout(() => {
      setMounted(false);
      reset();
    }, 320);
    return () => clearTimeout(timer);
  }, [reset, visible]);

  useEffect(() => {
    if (!visible) return;
    const current = rowRef.current;
    if (!current?.id || openedIdRef.current === current.id) return;

    openedIdRef.current = current.id;
    setActiveRow(current);
    setAddingCustomer(false);
    setStep('edit');
    const id = ++detailRequestId.current;
    const existingReview = reviewRef.current || current.review;
    if (existingReview?.draft) {
      setDraft(normalizeDraft(existingReview.draft));
      setNote(existingReview.note || '');
      setErrorType(existingReview.errorType || '');
      setErrorAmount(String(existingReview.errorAmount || '').replace(/^\$/, ''));
      setImages(normalizeReviewImages(existingReview.images));
      setDetailLoading(false);
      setDetailError('');
      return;
    }

    setDraft(buildDraft(current, null));
    setNote('');
    setErrorType('');
    setErrorAmount('');
    setImages([]);
    setDetailLoading(true);
    setDetailError('');

    const auth = resolvePosAuthForRow(sessionRef.current, current);
    fetchTransactionDetail(auth.token, {
      type: current.type,
      sourceId: current.sourceId,
      baseUrl: auth.baseUrl,
    })
      .then((detail) => {
        if (id !== detailRequestId.current) return;
        const enriched = withLineItems(current, detail);
        setActiveRow(enriched);
        setDraft(buildDraft(enriched, detail));
        onHydrateRef.current?.(enriched);
      })
      .catch((err) => {
        if (id !== detailRequestId.current) return;
        setDetailError(err?.message || 'Could not load full document. You can still edit the summary.');
      })
      .finally(() => {
        if (id === detailRequestId.current) setDetailLoading(false);
      });
  }, [row?.id, visible]);

  useEffect(() => {
    if (!visible) return undefined;
    let cancelled = false;
    fetchWebsitePrices()
      .then((catalog) => {
        if (!cancelled) setPricingOptions(catalogProductOptions(catalog));
      })
      .catch(() => {
        if (!cancelled) setPricingOptions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [visible]);

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
    setDraft((current) => {
      if (!current?.header) return current;
      return {
        ...current,
        header: current.header.map((field) => (field.key === key ? { ...field, value } : field)),
      };
    });
  };

  const updateItem = (id, part, value) => {
    setDraft((current) => {
      if (!current?.items) return current;
      return {
        ...current,
        items: current.items.map((item) =>
          item.id === id ? { ...item, [part]: { ...item[part], value } } : item,
        ),
      };
    });
  };

  const updatePayment = (id, part, value) => {
    setDraft((current) => {
      if (!current?.payments) return current;
      return {
        ...current,
        payments: current.payments.map((payment) =>
          payment.id === id ? { ...payment, [part]: { ...payment[part], value } } : payment,
        ),
      };
    });
  };

  const finish = () => {
    if (!activeRow || !draft) return;
    onSave?.(activeRow.id, buildReview(activeRow, draft, { note, errorType, errorAmount, images }));
    onClose?.();
  };

  if (!mounted || !heldRow) return null;

  const title = step === 'note' ? 'Error' : heldRow.reference || 'Edit';
  const changedCount = corrections.length;

  return (
    <TriageDrawer
      visible={visible}
      onClose={onClose}
      title={title}
      subtitle={
        step === 'edit'
          ? changedCount
            ? `${changedCount} ${changedCount === 1 ? 'change' : 'changes'}`
            : [heldRow.storeName, heldRow.dateLabel].filter(Boolean).join(' · ')
          : heldRow.reference
      }
      leftLabel={step === 'note' ? 'Back' : 'Cancel'}
      onLeft={step === 'note' ? () => setStep('edit') : onClose}
      rightLabel={step === 'edit' ? 'Next' : 'Done'}
      onRight={step === 'edit' ? () => setStep('note') : finish}
      rightDisabled={step === 'edit' && detailLoading}
      rightLeading={
        <Pressable
          style={[
            styles.addImageBtn,
            isMobile && styles.addImageBtnMobile,
            images.length >= MAX_REVIEW_IMAGES && styles.addImageBtnDisabled,
          ]}
          onPress={() => imagesRef.current?.addImage?.()}
          disabled={images.length >= MAX_REVIEW_IMAGES}
          accessibilityRole="button"
          accessibilityLabel="Add image"
        >
          <Ionicons name="image-outline" size={18} color={TEXT} />
          <Text style={styles.addImageBtnText}>Add image</Text>
        </Pressable>
      }
      widthRatio={0.78}
      minWidth={720}
    >
          {detailLoading && step === 'edit' ? (
            <View style={styles.inlineBusy}>
              <ActivityIndicator color={TEXT} />
              <Text style={styles.metaText}>Loading document…</Text>
            </View>
          ) : null}
          {detailError && step === 'edit' ? <Text style={styles.warnText}>{detailError}</Text> : null}

          {step === 'edit' ? (
            <ScrollView
              style={styles.body}
              contentContainerStyle={[styles.editContent, isMobile && styles.editContentMobile]}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <Text style={styles.groupHeader}>Details</Text>
              {addingCustomer ? (
                <NewCustomerPanel
                  onCancel={() => setAddingCustomer(false)}
                  onCreated={(created) => {
                    updateHeader('customer', created.label);
                    setAddingCustomer(false);
                  }}
                />
              ) : (
                <View style={styles.group}>
                  {headerField('customer') ? (
                    <LookupField
                      label={headerField('customer').label}
                      field={headerField('customer')}
                      onSearch={searchCustomerOptions}
                      onChange={(value) => updateHeader('customer', value)}
                      placeholder="Search customers"
                      rightAction={
                        <Pressable
                          style={styles.addIconButton}
                          onPress={() => setAddingCustomer(true)}
                          accessibilityLabel="New customer"
                        >
                          <Ionicons name="add-circle-outline" size={22} color={TEXT} />
                        </Pressable>
                      }
                    />
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
                      last
                    />
                  ) : null}
                </View>
              )}

              {(draft?.items || []).length === 0 ? (
                <>
                  <Text style={styles.groupHeader}>Line items</Text>
                  <View style={styles.group}>
                    <Text style={styles.emptyText}>No line items</Text>
                  </View>
                </>
              ) : (
                draft.items.map((item, index) => (
                  <View key={item.id}>
                    <Text style={styles.groupHeader}>Item {index + 1}</Text>
                    <View style={styles.group}>
                      <LookupField
                        label="Product"
                        field={item.name}
                        options={pricingOptions}
                        filterOptions={(list, query) =>
                          filterCatalogProductOptions(list, query, item.name.original)
                        }
                        onSearch={searchProductOptions}
                        allowCustom
                        onChange={(value) => updateItem(item.id, 'name', value)}
                        placeholder="Search pricing or type custom"
                      />
                      <CorrectableField
                        label={isWeightUnit(item.unitType) ? 'Weight' : 'Qty'}
                        field={item.qty}
                        suffix={item.unitType || 'ea'}
                        onChange={(value) => updateItem(item.id, 'qty', value)}
                        keyboardType="decimal-pad"
                      />
                      <CorrectableField
                        label="Unit cost"
                        field={item.unit}
                        suffix={item.unitType && item.unitType !== 'ea' ? `/${item.unitType}` : null}
                        onChange={(value) => updateItem(item.id, 'unit', value)}
                        keyboardType="decimal-pad"
                      />
                      <CorrectableField
                        label="Amount"
                        field={item.amount}
                        onChange={(value) => updateItem(item.id, 'amount', value)}
                        last
                      />
                    </View>
                  </View>
                ))
              )}

              {(draft?.payments || []).length > 0
                ? draft.payments.map((payment, index) => (
                    <View key={payment.id}>
                      <Text style={styles.groupHeader}>Payment {index + 1}</Text>
                      <View style={styles.group}>
                        <CorrectableField
                          label="Method"
                          field={payment.method}
                          onChange={(value) => updatePayment(payment.id, 'method', value)}
                        />
                        <CorrectableField
                          label="Amount"
                          field={payment.amount}
                          onChange={(value) => updatePayment(payment.id, 'amount', value)}
                          last
                        />
                      </View>
                    </View>
                  ))
                : null}

              <Text style={styles.groupHeader}>Photos</Text>
              <View style={styles.groupPadded}>
                <TriageCorrectionImages
                  ref={imagesRef}
                  images={images}
                  onChange={setImages}
                  compact={isMobile}
                  hideHeading
                  hideActions
                />
              </View>
            </ScrollView>
          ) : (
            <ScrollView
              style={styles.body}
              contentContainerStyle={[styles.editContent, isMobile && styles.editContentMobile]}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <Text style={styles.groupHeader}>Corrections</Text>
              <View style={styles.group}>
                {corrections.length === 0 ? (
                  <Text style={styles.emptyText}>No field corrections</Text>
                ) : (
                  corrections.map((correction, index) => (
                    <View
                      key={correction.key}
                      style={[styles.correctionItem, index === corrections.length - 1 && styles.iosRowLast]}
                    >
                      <Text style={styles.iosRowLabel}>{correction.label}</Text>
                      <CorrectionPair original={correction.original} value={correction.value} />
                    </View>
                  ))
                )}
              </View>

              <Text style={styles.groupHeader}>Note</Text>
              <View style={styles.group}>
                <TextInput
                  style={styles.noteInput}
                  value={note}
                  onChangeText={setNote}
                  placeholder="Describe the error"
                  placeholderTextColor="#c7c7cc"
                  multiline
                  textAlignVertical="top"
                />
              </View>

              <Text style={styles.groupHeader}>Photos</Text>
              <View style={styles.groupPadded}>
                <TriageCorrectionImages
                  ref={imagesRef}
                  images={images}
                  onChange={setImages}
                  compact={isMobile}
                  hideHeading
                  hideActions
                />
              </View>

              <Text style={styles.groupHeader}>Type of error</Text>
              <View style={styles.group}>
                <View style={[styles.iosRow, styles.iosRowLast]}>
                  <TextInput
                    style={styles.iosRowInput}
                    value={errorType}
                    onChangeText={setErrorType}
                    placeholder="Describe the type of error"
                    placeholderTextColor="#c7c7cc"
                    autoCapitalize="sentences"
                  />
                </View>
              </View>
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

              <Text style={styles.groupHeader}>Amount</Text>
              <View style={styles.group}>
                <View style={[styles.amountBox, styles.iosRowLast]}>
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
              </View>
            </ScrollView>
          )}
    </TriageDrawer>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
    minHeight: 0,
  },
  addImageBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 36,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: HAIRLINE,
    backgroundColor: '#fff',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  addImageBtnMobile: {
    minHeight: 44,
    width: '100%',
  },
  addImageBtnDisabled: {
    opacity: 0.35,
  },
  addImageBtnText: {
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: TEXT,
  },
  editContent: {
    paddingHorizontal: 28,
    paddingTop: 16,
    paddingBottom: 40,
  },
  editContentMobile: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 28,
  },
  iosRowStacked: {
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: 4,
    paddingVertical: 10,
  },
  iosRowLabelStacked: {
    width: 'auto',
    fontSize: 13,
    fontWeight: '600',
    color: SECONDARY,
  },
  iosRowInputStacked: {
    textAlign: 'left',
  },
  groupHeader: {
    fontFamily,
    fontSize: 12,
    fontWeight: '600',
    color: TEXT,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
    marginTop: 22,
    marginBottom: 8,
  },
  group: {
    backgroundColor: '#fff',
    borderRadius: 10,
    overflow: 'visible',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: HAIRLINE,
  },
  groupPadded: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: HAIRLINE,
  },
  iosRowWrap: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: HAIRLINE,
  },
  iosRowLast: {
    borderBottomWidth: 0,
  },
  iosRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 12,
  },
  iosRowLabel: {
    fontFamily,
    width: 92,
    flexShrink: 0,
    fontSize: 17,
    color: TEXT,
  },
  iosRowControl: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  iosRowInput: {
    fontFamily,
    flex: 1,
    minWidth: 0,
    fontSize: 17,
    color: TEXT,
    paddingVertical: 4,
    outlineStyle: 'none',
    textAlign: 'right',
  },
  iosRowInputChanged: {
    fontWeight: '600',
  },
  valueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 6,
  },
  unitLock: {
    fontFamily,
    flexShrink: 0,
    fontSize: 15,
    color: SECONDARY,
  },
  inlineBusy: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 10,
  },
  metaText: {
    fontFamily,
    fontSize: 13,
    color: SECONDARY,
  },
  warnText: {
    fontFamily,
    fontSize: 13,
    color: SECONDARY,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  errorText: {
    fontFamily,
    fontSize: 13,
    color: '#FF3B30',
    paddingHorizontal: 4,
    paddingTop: 8,
  },
  emptyText: {
    fontFamily,
    fontSize: 16,
    color: SECONDARY,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  changedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
  },
  changedOriginal: {
    flex: 1,
    minWidth: 0,
    textAlign: 'right',
  },
  reverseButton: {
    flexShrink: 0,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  reverseButtonText: {
    fontFamily,
    fontSize: 15,
    fontWeight: '400',
    color: TEXT,
  },
  lookupBlock: {
    zIndex: 4,
  },
  lookupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  lookupInputWrap: {
    flex: 1,
    minWidth: 0,
    position: 'relative',
  },
  lookupSpinner: {
    position: 'absolute',
    right: 0,
    top: 6,
  },
  lookupMenu: {
    marginHorizontal: 12,
    marginBottom: 8,
    backgroundColor: '#fff',
    borderRadius: 12,
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
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: HAIRLINE,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  lookupOptionLabel: {
    fontFamily,
    fontSize: 17,
    color: TEXT,
  },
  lookupOptionSub: {
    fontFamily,
    fontSize: 13,
    color: SECONDARY,
    marginTop: 1,
  },
  lookupEmpty: {
    fontFamily,
    fontSize: 15,
    color: SECONDARY,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  addIconButton: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  newCustomerCard: {
    gap: 0,
  },
  newCustomerActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    paddingTop: 10,
  },
  struckText: {
    fontFamily,
    fontSize: 13,
    color: STRUCK,
    textDecorationLine: 'line-through',
  },
  correctedText: {
    fontFamily,
    fontSize: 17,
    fontWeight: '600',
    color: TEXT,
  },
  correctionPair: {
    flex: 1,
    minWidth: 0,
    alignItems: 'flex-end',
    gap: 2,
  },
  correctionItem: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: HAIRLINE,
    gap: 6,
  },
  noteInput: {
    fontFamily,
    fontSize: 17,
    color: TEXT,
    minHeight: 120,
    paddingHorizontal: 16,
    paddingVertical: 12,
    outlineStyle: 'none',
  },
  typeChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 4,
    paddingTop: 10,
  },
  typeChip: {
    backgroundColor: '#fff',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minHeight: 34,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: HAIRLINE,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  typeChipActive: {
    backgroundColor: TEXT,
    borderColor: TEXT,
  },
  typeChipText: {
    fontFamily,
    fontSize: 14,
    color: TEXT,
  },
  typeChipTextActive: {
    color: '#fff',
    fontWeight: '600',
  },
  amountBox: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    minHeight: 44,
  },
  amountPrefix: {
    fontFamily,
    fontSize: 17,
    fontWeight: '600',
    color: TEXT,
    marginRight: 6,
  },
  amountInput: {
    flex: 1,
    fontFamily,
    fontSize: 17,
    fontWeight: '600',
    color: TEXT,
    paddingVertical: 10,
    outlineStyle: 'none',
  },
});
