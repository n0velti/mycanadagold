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
import { MOBILE, mobileSafeBottom, mobileSafeTop } from '../lib/mobileUi';
import {
  createClient,
  fetchLookupLocations,
  fetchLookupUsers,
  mergeEmployeeOptions,
  searchClients,
  searchProducts,
} from '../lib/triageLookups';
import { catalogProductOptions, fetchWebsitePrices, filterCatalogProductOptions } from '../lib/websitePrices';

const fontFamily = Platform.select({
  ios: 'Sohne',
  android: 'Sohne',
  default: 'Sohne',
});

const BLUE = MOBILE.blue;
const TEXT = '#1d1d1f';
const SECONDARY = '#8e8e93';
const HAIRLINE = 'rgba(60, 60, 67, 0.18)';
const STRUCK = '#8e8e93';
const CHANGED = '#FF9500';
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

function CorrectableField({ label, field, onChange, keyboardType, last }) {
  const changed = fieldChanged(field);
  const reverse = () => onChange(field.original ?? '');
  return (
    <View style={[styles.iosRowWrap, last && styles.iosRowLast]}>
      <View style={styles.iosRow}>
        {label ? <Text style={styles.iosRowLabel}>{label}</Text> : null}
        <View style={styles.iosRowControl}>
          <ChangedOriginal field={field} onReverse={reverse} />
          <TextInput
            style={[styles.iosRowInput, changed && styles.iosRowInputChanged]}
            value={field.value}
            onChangeText={onChange}
            placeholder={field.original || '—'}
            placeholderTextColor="#c7c7cc"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType={keyboardType || 'default'}
          />
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

  const reverse = () => {
    const original = field.original ?? '';
    onChange(original);
    setQuery(original);
    setOpen(false);
  };

  return (
    <View style={[styles.iosRowWrap, last && styles.iosRowLast, styles.lookupBlock]}>
      <View style={styles.iosRow}>
        {label ? <Text style={styles.iosRowLabel}>{label}</Text> : null}
        <View style={styles.iosRowControl}>
          <ChangedOriginal field={field} onReverse={reverse} />
          <View style={styles.lookupRow}>
            <View style={styles.lookupInputWrap}>
              <TextInput
                style={[styles.iosRowInput, changed && styles.iosRowInputChanged]}
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
        </View>
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
      <Text style={styles.groupHeader}>New customer</Text>
      <View style={styles.group}>
        <View style={styles.iosRow}>
          <Text style={styles.iosRowLabel}>First</Text>
          <TextInput
            style={styles.iosRowInput}
            value={firstName}
            onChangeText={setFirstName}
            placeholder="First name"
            placeholderTextColor="#c7c7cc"
          />
        </View>
        <View style={styles.iosRow}>
          <Text style={styles.iosRowLabel}>Last</Text>
          <TextInput
            style={styles.iosRowInput}
            value={lastName}
            onChangeText={setLastName}
            placeholder="Last name"
            placeholderTextColor="#c7c7cc"
          />
        </View>
        <View style={styles.iosRow}>
          <Text style={styles.iosRowLabel}>Email</Text>
          <TextInput
            style={styles.iosRowInput}
            value={email}
            onChangeText={setEmail}
            placeholder="name@email.com"
            placeholderTextColor="#c7c7cc"
            autoCapitalize="none"
            keyboardType="email-address"
          />
        </View>
        <View style={[styles.iosRow, styles.iosRowLast]}>
          <Text style={styles.iosRowLabel}>Phone</Text>
          <TextInput
            style={styles.iosRowInput}
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
        <Pressable onPress={onCancel} hitSlop={8} accessibilityRole="button">
          <Text style={styles.navAction}>Cancel</Text>
        </Pressable>
        <Pressable onPress={save} disabled={busy} hitSlop={8} accessibilityRole="button">
          {busy ? <ActivityIndicator color={BLUE} /> : <Text style={[styles.navAction, styles.navActionEmph]}>Add</Text>}
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
  const [pricingOptions, setPricingOptions] = useState([]);
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

  const title = step === 'note' ? 'Error' : heldRow.reference || 'Edit';

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
            style={[styles.navBar, isMobile && styles.navBarMobile]}
            {...(Platform.OS === 'web' && isMobile ? { className: 'cgold-mobile-sheet-top' } : null)}
          >
            <Pressable
              onPress={step === 'note' ? () => setStep('edit') : onClose}
              hitSlop={8}
              style={styles.navSide}
              accessibilityRole="button"
              accessibilityLabel={step === 'note' ? 'Back' : 'Cancel'}
            >
              <Text style={styles.navAction}>{step === 'note' ? 'Back' : 'Cancel'}</Text>
            </Pressable>
            <Text style={styles.navTitle} numberOfLines={1}>
              {title}
            </Text>
            <Pressable
              onPress={step === 'edit' ? () => setStep('note') : finish}
              hitSlop={8}
              style={styles.navSide}
              disabled={step === 'edit' && detailLoading}
              accessibilityRole="button"
              accessibilityLabel={step === 'edit' ? 'Next' : 'Done'}
            >
              <Text style={[styles.navAction, styles.navActionEmph, styles.navSideRight]}>
                {step === 'edit' ? 'Next' : 'Done'}
              </Text>
            </Pressable>
          </View>

          {detailLoading && step === 'edit' ? (
            <View style={styles.inlineBusy}>
              <ActivityIndicator color={BLUE} />
              <Text style={styles.metaText}>Loading document…</Text>
            </View>
          ) : null}
          {detailError && step === 'edit' ? <Text style={styles.warnText}>{detailError}</Text> : null}

          {step === 'edit' ? (
            <ScrollView
              style={styles.body}
              contentContainerStyle={styles.editContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <Text style={styles.groupHeader}>Details</Text>
              {addingCustomer ? (
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
                          <Ionicons name="add-circle-outline" size={22} color={BLUE} />
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
                        label="Qty"
                        field={item.qty}
                        onChange={(value) => updateItem(item.id, 'qty', value)}
                      />
                      <CorrectableField
                        label="Unit"
                        field={item.unit}
                        onChange={(value) => updateItem(item.id, 'unit', value)}
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
                <TriageCorrectionImages images={images} onChange={setImages} compact={isMobile} hideHeading />
              </View>
            </ScrollView>
          ) : (
            <ScrollView
              style={styles.body}
              contentContainerStyle={styles.editContent}
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
                <TriageCorrectionImages images={images} onChange={setImages} compact={isMobile} hideHeading />
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
    backgroundColor: MOBILE.bg,
    ...Platform.select({
      web: { boxShadow: '-12px 0 32px rgba(0,0,0,0.18)' },
      default: { elevation: 12 },
    }),
  },
  drawerPanelMobile: {
    paddingBottom: Platform.OS === 'ios' ? Math.max(20, mobileSafeBottom()) : 12,
    backgroundColor: MOBILE.bg,
  },
  navBar: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 52,
    paddingHorizontal: 8,
    backgroundColor: 'rgba(242,242,247,0.94)',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: HAIRLINE,
  },
  navBarMobile: {
    paddingTop: Platform.OS === 'ios' ? mobileSafeTop() - 12 : 6,
  },
  navSide: {
    width: 88,
    minHeight: 44,
    justifyContent: 'center',
  },
  navSideRight: {
    textAlign: 'right',
  },
  navAction: {
    fontFamily,
    fontSize: 17,
    fontWeight: '400',
    color: BLUE,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  navActionEmph: {
    fontWeight: '600',
  },
  navTitle: {
    fontFamily,
    flex: 1,
    fontSize: 17,
    fontWeight: '600',
    color: TEXT,
    textAlign: 'center',
    letterSpacing: -0.3,
  },
  body: {
    flex: 1,
    minHeight: 0,
  },
  editContent: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 32,
  },
  groupHeader: {
    fontFamily,
    fontSize: 13,
    fontWeight: '400',
    color: SECONDARY,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginTop: 18,
    marginBottom: 6,
    marginLeft: 4,
  },
  group: {
    backgroundColor: '#fff',
    borderRadius: 12,
    overflow: 'visible',
  },
  groupPadded: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
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
    fontSize: 17,
    color: TEXT,
    paddingVertical: 4,
    outlineStyle: 'none',
    textAlign: 'right',
  },
  iosRowInputChanged: {
    color: CHANGED,
    fontWeight: '600',
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
    color: CHANGED,
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
    color: BLUE,
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
    color: CHANGED,
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
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    minHeight: 36,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  typeChipActive: {
    backgroundColor: '#EAF2FF',
  },
  typeChipText: {
    fontFamily,
    fontSize: 15,
    color: TEXT,
  },
  typeChipTextActive: {
    color: BLUE,
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
