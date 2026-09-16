import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
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
  formatErrorAmount,
  isListedErrorType,
  MAX_REVIEW_IMAGES,
  normalizeDraft,
  normalizeReviewImages,
  rankLabeledCounts,
  VISIBLE_ERROR_TYPE_LIMIT,
  withItemPartUpdated,
  withSyncedHeaderTotal,
} from '../lib/triageDraft';
import TriageCorrectionImages from './TriageCorrectionImages';
import { FONT, T, TextAction, TriageDrawer, SearchField, StaffAvatar, useHeldValue } from './TriageKit';
import { PoThumb } from './TriageTable';
import { useIsMobile } from '../lib/mobileUi';
import {
  fetchLookupLocations,
  fetchLookupUsers,
  mergeEmployeeOptions,
  searchClients,
  searchProducts,
} from '../lib/triageLookups';
import { catalogProductOptions, fetchWebsitePrices, filterCatalogProductOptions } from '../lib/websitePrices';
import { findStaffByEmployeeName, listStaffProfiles } from '../lib/permissions';
import { useTransferWorkflow } from '../lib/transferWorkflow';

const fontFamily = FONT;
const TEXT = T.text;
const SECONDARY = T.secondary;
const HAIRLINE = T.hairline;
const STRUCK = T.secondary;
const MOBILE_BREAKPOINT = 768;

const ITEM_COLUMNS = [
  { key: 'name', label: 'Product' },
  { key: 'qty', label: 'Qty' },
  { key: 'unit', label: 'Unit cost' },
  { key: 'amount', label: 'Amount' },
];

const PAYMENT_COLUMNS = [
  { key: 'method', label: 'Method' },
  { key: 'till', label: 'Till' },
  { key: 'currency', label: 'Currency' },
  { key: 'amount', label: 'Amount' },
  { key: 'notes', label: 'Notes' },
];

const CURRENCY_OPTIONS = [
  { id: 'CAD', label: 'CAD' },
  { id: 'USD', label: 'USD' },
];

function fieldHasText(field) {
  return Boolean(String(field?.value || field?.original || '').trim());
}

function paymentTypeLabel(payment) {
  const method = String(payment?.method?.value || 'Payment').trim() || 'Payment';
  const till = String(payment?.till?.value || '').trim();
  const currency = String(payment?.currency?.value || '').trim().toUpperCase();
  const parts = [method];
  if (till) parts.push(till);
  if (currency && currency !== 'CAD') parts.push(currency);
  return parts.join(' · ');
}

function OptionRow({ label, count, selected, last, onPress }) {
  return (
    <Pressable
      style={[styles.detailReadRow, last && styles.detailReadRowLast, selected && styles.optionRowOn]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={count != null ? `${label}, ${count}` : label}
    >
      <Text style={[styles.optionLabel, selected && styles.optionLabelOn]} numberOfLines={1}>
        {label}
      </Text>
      {count != null ? <Text style={[styles.optionCount, selected && styles.optionCountOn]}>{count}</Text> : null}
      {selected ? <Ionicons name="checkmark" size={16} color="#C2410C" /> : null}
    </Pressable>
  );
}

function ErrorReportFields({
  note,
  setNote,
  images,
  setImages,
  isMobile,
  firstHeader,
  typeQuery,
  setTypeQuery,
  visibleTypeOptions,
  errorType,
  setErrorType,
  addingType,
  newType,
  setNewType,
  addErrorType,
  setAddingType,
}) {
  return (
    <>
      <Text style={[styles.groupHeader, firstHeader && styles.groupHeaderFirst]}>Note</Text>
      <View style={[styles.detailsCard, styles.paneCard]}>
        <TextInput
          style={styles.noteCardInput}
          value={note}
          onChangeText={setNote}
          placeholder="Describe the error"
          placeholderTextColor="#c7c7cc"
          multiline
          textAlignVertical="top"
        />
      </View>

      <Text style={styles.groupHeader}>Photos</Text>
      <View style={[styles.detailsCard, styles.photoCard, styles.paneCard]}>
        <TriageCorrectionImages
          images={images}
          onChange={setImages}
          compact={isMobile}
          hideHeading
          hideActions
          showSourceButtons
        />
      </View>

      <Text style={styles.groupHeader}>Type of error</Text>
      <View style={[styles.detailsCard, styles.paneCard]}>
        <View style={styles.typeSearchWrap}>
          <SearchField
            value={typeQuery}
            onChangeText={setTypeQuery}
            placeholder="Search types"
            style={styles.typeSearch}
          />
        </View>
        {visibleTypeOptions.length ? (
          visibleTypeOptions.map((option) => (
            <OptionRow
              key={option.label}
              label={option.label}
              count={option.count}
              selected={errorType === option.label}
              onPress={() => setErrorType((current) => (current === option.label ? '' : option.label))}
            />
          ))
        ) : (
          <Text style={styles.typeSearchEmpty}>No matching types</Text>
        )}
        {addingType ? (
          <AddOptionRow
            label="Add error type"
            placeholder="New error type"
            value={newType}
            onChange={setNewType}
            onSubmit={addErrorType}
            onCancel={() => {
              setAddingType(false);
              setNewType('');
            }}
          />
        ) : (
          <Pressable
            style={[styles.detailReadRow, styles.detailReadRowLast]}
            onPress={() => setAddingType(true)}
            accessibilityRole="button"
            accessibilityLabel="Add error type"
          >
            <Ionicons name="add" size={16} color={T.blue} />
            <Text style={styles.optionAddLink}>Add type</Text>
          </Pressable>
        )}
      </View>
    </>
  );
}

function PurchaseSummary({
  header,
  items,
  payments,
  staffProfiles,
  showPaymentTill,
  showPaymentNotes,
  changedCount,
}) {
  return (
    <>
      <Text style={[styles.groupHeader, styles.groupHeaderFirst]}>Purchase</Text>
      <Text style={styles.summaryMeta}>
        {changedCount
          ? `${changedCount} ${changedCount === 1 ? 'correction' : 'corrections'}`
          : 'No corrections'}
      </Text>
      <View style={[styles.detailsCard, styles.paneCard]}>
        {header.map((field, index) => {
          const buyer =
            field.key === 'employee' ? findStaffByEmployeeName(staffProfiles, field.value) : null;
          return (
            <View
              key={field.key}
              style={[styles.detailReadRow, index === header.length - 1 && styles.detailReadRowLast]}
            >
              <Text style={styles.detailReadLabel} numberOfLines={1}>
                {field.label}
              </Text>
              {field.key === 'employee' ? (
                <View style={styles.detailPerson}>
                  <StaffAvatar uri={buyer?.avatarUrl || ''} name={field.value || 'Employee'} size={24} />
                  <ReadValue field={field} />
                </View>
              ) : (
                <ReadValue field={field} />
              )}
            </View>
          );
        })}
      </View>

      <Text style={styles.groupHeader}>Items</Text>
      {items.length === 0 ? (
        <View style={[styles.dataTable, styles.paneCard]}>
          <Text style={styles.emptyText}>No line items</Text>
        </View>
      ) : (
        <View style={[styles.dataTable, styles.paneCard]}>
          <View style={styles.dataTableHead}>
            <View style={styles.colPhoto} />
            <Text style={[styles.dataTableHeadText, styles.colProduct]}>Product</Text>
            <Text style={[styles.dataTableHeadText, styles.colQty]}>Qty</Text>
            <Text style={[styles.dataTableHeadText, styles.colUnit]}>Unit cost</Text>
            <Text style={[styles.dataTableHeadText, styles.colAmount]}>Amount</Text>
          </View>
          {items.map((item, index) => (
            <View
              key={item.id}
              style={[styles.dataTableRow, index === items.length - 1 && styles.dataTableRowLast]}
            >
              <View style={styles.colPhoto}>
                <PoThumb urls={item.imageUrls} label={item.name?.value || 'Item'} />
              </View>
              <View style={styles.colProduct}>
                <ReadValue field={item.name} />
              </View>
              <View style={styles.colQty}>
                <ReadValue field={item.qty} suffix={item.unitType || 'ea'} />
              </View>
              <View style={styles.colUnit}>
                <ReadValue
                  field={item.unit}
                  suffix={item.unitType && item.unitType !== 'ea' ? `/${item.unitType}` : null}
                />
              </View>
              <View style={styles.colAmount}>
                <ReadValue field={item.amount} />
              </View>
            </View>
          ))}
        </View>
      )}

      <Text style={styles.groupHeader}>Payments</Text>
      {payments.length === 0 ? (
        <View style={[styles.dataTable, styles.paneCard]}>
          <Text style={styles.emptyText}>No payments</Text>
        </View>
      ) : (
        <View style={[styles.dataTable, styles.paneCard]}>
          <View style={styles.dataTableHead}>
            <Text style={[styles.dataTableHeadText, styles.colMethod]}>Method</Text>
            {showPaymentTill ? (
              <Text style={[styles.dataTableHeadText, styles.colTill]}>Till</Text>
            ) : null}
            <Text style={[styles.dataTableHeadText, styles.colCurrency]}>Currency</Text>
            <Text style={[styles.dataTableHeadText, styles.colPayAmount]}>Amount</Text>
            {showPaymentNotes ? (
              <Text style={[styles.dataTableHeadText, styles.colPayNotes]}>Notes</Text>
            ) : null}
          </View>
          {payments.map((payment, index) => (
            <View
              key={payment.id}
              style={[styles.dataTableRow, index === payments.length - 1 && styles.dataTableRowLast]}
            >
              <View style={styles.colMethod}>
                <ReadValue field={payment.method} />
              </View>
              {showPaymentTill ? (
                <View style={styles.colTill}>
                  <ReadValue field={payment.till} />
                </View>
              ) : null}
              <View style={styles.colCurrency}>
                <ReadValue field={payment.currency} />
              </View>
              <View style={styles.colPayAmount}>
                <ReadValue field={payment.amount} />
              </View>
              {showPaymentNotes ? (
                <View style={styles.colPayNotes}>
                  <ReadValue field={payment.notes} />
                </View>
              ) : null}
            </View>
          ))}
        </View>
      )}
    </>
  );
}

function AddOptionRow({ label, placeholder, value, onChange, onSubmit, onCancel, keyboardType }) {
  return (
    <View style={[styles.detailReadRow, styles.detailReadRowLast]}>
      <TextInput
        style={styles.optionAddInput}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor="#c7c7cc"
        autoFocus
        autoCapitalize="sentences"
        autoCorrect={false}
        keyboardType={keyboardType || 'default'}
        onSubmitEditing={onSubmit}
      />
      <Pressable
        onPress={onCancel}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Cancel"
        style={styles.optionAddBtn}
      >
        <Text style={styles.optionAddCancel}>Cancel</Text>
      </Pressable>
      <Pressable
        onPress={onSubmit}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={label}
        style={styles.optionAddBtn}
      >
        <Text style={styles.optionAddDone}>Add</Text>
      </Pressable>
    </View>
  );
}

function EditButton({ label, onPress }) {
  return (
    <Pressable
      style={styles.editBtn}
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Ionicons name="pencil-outline" size={16} color={T.blue} />
    </Pressable>
  );
}

function ReadValue({ field, suffix }) {
  const changed = fieldChanged(field);
  const valueText = [field?.value || '—', suffix].filter(Boolean).join(' ');
  if (!changed) {
    return (
      <Text style={styles.readValue} numberOfLines={2}>
        {valueText}
      </Text>
    );
  }
  const originalText = [field?.original || '—', suffix].filter(Boolean).join(' ');
  return (
    <View
      style={styles.readValueChangedCol}
      accessibilityLabel={`${originalText} corrected to ${valueText}`}
    >
      <Text style={styles.readValueStruck} numberOfLines={2}>
        {originalText}
      </Text>
      <Text style={styles.readValueChanged} numberOfLines={2}>
        {valueText}
      </Text>
    </View>
  );
}

function MoneyPreviewRow({ label, field, last }) {
  return (
    <View style={[styles.iosRowWrap, last && styles.iosRowLast]}>
      <View style={styles.iosRow}>
        <Text style={styles.iosRowLabel} numberOfLines={1}>
          {label}
        </Text>
        <ReadValue field={field} />
      </View>
    </View>
  );
}

function ItemTotalsPreview({ item, headerTotal, payments, includeAmount }) {
  const list = Array.isArray(payments) ? payments : [];
  return (
    <>
      {includeAmount ? <MoneyPreviewRow label="Amount" field={item?.amount} /> : null}
      <MoneyPreviewRow label="Total" field={headerTotal} last={!list.length} />
      {list.map((payment, index) => (
        <MoneyPreviewRow
          key={payment.id}
          label={paymentTypeLabel(payment)}
          field={payment.amount}
          last={index === list.length - 1}
        />
      ))}
    </>
  );
}

function ColumnChips({ columns, value, onChange }) {
  return (
    <View style={styles.columnChips}>
      {columns.map((column) => {
        const on = value === column.key;
        return (
          <Pressable
            key={column.key}
            style={[styles.columnChip, on && styles.columnChipOn]}
            onPress={() => onChange(column.key)}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            accessibilityLabel={`Edit ${column.label}`}
          >
            <Text style={[styles.columnChipText, on && styles.columnChipTextOn]}>{column.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
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

function ChangedOriginal({ field, onReverse, compact }) {
  if (!fieldChanged(field)) return null;
  return (
    <View style={[styles.changedRow, compact && styles.changedRowCompact]}>
      <Text
        style={[styles.struckText, compact ? styles.changedOriginalCompact : styles.changedOriginal]}
        numberOfLines={1}
      >
        {field.original || '—'}
      </Text>
      <ReverseButton onPress={onReverse} />
    </View>
  );
}

function CorrectableField({ label, field, onChange, keyboardType, last, suffix, compact, bare }) {
  const stacked = useIsMobile() && !compact;
  const changed = fieldChanged(field);
  const reverse = () => onChange(field.original ?? '');
  return (
    <View style={[compact ? styles.cellWrap : styles.iosRowWrap, last && styles.iosRowLast, compact && !bare && !last && styles.compactDivider]}>
      <View style={[compact ? styles.cellRow : styles.iosRow, stacked && styles.iosRowStacked]}>
        {label ? (
          <Text style={[compact ? styles.compactLabel : styles.iosRowLabel, stacked && styles.iosRowLabelStacked]}>
            {label}
          </Text>
        ) : null}
        <View style={compact ? styles.cellControl : styles.iosRowControl}>
          <ChangedOriginal field={field} onReverse={reverse} compact={compact} />
          <View style={[styles.valueRow, compact && styles.valueRowCompact]}>
            <TextInput
              style={[
                styles.iosRowInput,
                stacked && styles.iosRowInputStacked,
                compact && styles.compactInput,
                changed && styles.iosRowInputChanged,
              ]}
              value={String(field?.value ?? '')}
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
  compact,
  bare,
}) {
  const stacked = useIsMobile() && !compact;
  const changed = fieldChanged(field);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(String(field?.value || ''));
  const [remote, setRemote] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setQuery(String(field?.value || ''));
  }, [field?.value]);

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
    <View style={[compact ? styles.cellWrap : styles.iosRowWrap, last && styles.iosRowLast, compact && !bare && !last && styles.compactDivider, styles.lookupBlock]}>
      <View style={[compact ? styles.cellRow : styles.iosRow, stacked && styles.iosRowStacked]}>
        {label ? (
          <Text style={[compact ? styles.compactLabel : styles.iosRowLabel, stacked && styles.iosRowLabelStacked]}>
            {label}
          </Text>
        ) : null}
        <View style={compact ? styles.cellControl : styles.iosRowControl}>
          <ChangedOriginal field={field} onReverse={reverse} compact={compact} />
          <View style={styles.lookupRow}>
            <View style={styles.lookupInputWrap}>
              <TextInput
                style={[
                  styles.iosRowInput,
                  stacked && styles.iosRowInputStacked,
                  compact && styles.compactInput,
                  changed && styles.iosRowInputChanged,
                ]}
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
            {compact ? null : <Ionicons name="chevron-forward" size={16} color="#c7c7cc" />}
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
  const { reviews = [] } = useTransferWorkflow();
  const [mounted, setMounted] = useState(visible);
  if (visible && !mounted) setMounted(true);

  const [step, setStep] = useState('edit');
  const [activeRow, setActiveRow] = useState(null);
  const [draft, setDraft] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [note, setNote] = useState('');
  const [errorType, setErrorType] = useState('');
  const [errorAmount, setErrorAmount] = useState('');
  const [extraTypes, setExtraTypes] = useState([]);
  const [addingType, setAddingType] = useState(false);
  const [newType, setNewType] = useState('');
  const [typeQuery, setTypeQuery] = useState('');
  const [images, setImages] = useState([]);
  const [locations, setLocations] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [staffProfiles, setStaffProfiles] = useState([]);
  const [pricingOptions, setPricingOptions] = useState([]);
  const [addingCustomer, setAddingCustomer] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
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
    setExtraTypes([]);
    setAddingType(false);
    setNewType('');
    setTypeQuery('');
    setImages([]);
    setAddingCustomer(false);
    setEditTarget(null);
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
    setEditTarget(null);
    setStep('edit');
    const id = ++detailRequestId.current;
    const existingReview = reviewRef.current || current.review;
    const safeDraft = (row, detail) => {
      try {
        return normalizeDraft(buildDraft(row, detail));
      } catch (err) {
        setDetailError(err?.message || 'Could not read this document.');
        return { header: [], items: [], payments: [] };
      }
    };
    if (existingReview?.draft) {
      try {
        setDraft(normalizeDraft(existingReview.draft));
        setDetailError('');
      } catch (err) {
        setDraft(safeDraft(current, null));
        setDetailError(err?.message || 'Could not read saved edits.');
      }
      setNote(existingReview.note || '');
      setErrorType(isListedErrorType(existingReview.errorType) ? existingReview.errorType : '');
      setErrorAmount(formatErrorAmount(existingReview.errorAmount));
      setImages(normalizeReviewImages(existingReview.images));
      setDetailLoading(false);
      return;
    }

    setDraft(safeDraft(current, null));
    setNote('');
    setErrorType('');
    setErrorAmount('');
    setImages([]);
    setDetailLoading(true);

    const auth = resolvePosAuthForRow(sessionRef.current, current);
    fetchTransactionDetail(auth.token, {
      type: current.type,
      sourceId: current.sourceId,
      baseUrl: auth.baseUrl,
    })
      .then((detail) => {
        if (id !== detailRequestId.current) return;
        try {
          const enriched = withLineItems(current, detail);
          setActiveRow(enriched);
          setDraft(safeDraft(enriched, detail));
          onHydrateRef.current?.(enriched);
        } catch (err) {
          setDetailError(err?.message || 'Could not read this document.');
        }
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

  useEffect(() => {
    if (!visible) return undefined;
    let cancelled = false;
    listStaffProfiles()
      .then((rows) => {
        if (!cancelled) setStaffProfiles(rows);
      })
      .catch(() => {
        if (!cancelled) setStaffProfiles([]);
      });
    return () => {
      cancelled = true;
    };
  }, [visible]);

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
  const typeOptions = useMemo(
    () =>
      rankLabeledCounts(
        (reviews || []).map((row) => (isListedErrorType(row?.review?.errorType) ? row.review.errorType : '')),
        [...ERROR_TYPES, ...extraTypes, errorType].filter(isListedErrorType),
      ),
    [errorType, extraTypes, reviews],
  );
  const visibleTypeOptions = useMemo(() => {
    const query = typeQuery.trim().toLowerCase();
    if (query) {
      return typeOptions.filter((option) => option.label.toLowerCase().includes(query));
    }
    const top = typeOptions.slice(0, VISIBLE_ERROR_TYPE_LIMIT);
    if (errorType && !top.some((option) => option.label === errorType)) {
      const selected = typeOptions.find((option) => option.label === errorType);
      if (selected) return [selected, ...top];
    }
    return top;
  }, [errorType, typeOptions, typeQuery]);
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
    setDraft((current) => withItemPartUpdated(current, id, part, value));
  };

  const updatePayment = (id, part, value) => {
    setDraft((current) => {
      if (!current?.payments) return current;
      const next = {
        ...current,
        payments: current.payments.map((payment) =>
          payment.id === id
            ? {
                ...payment,
                [part]: { original: payment[part]?.original ?? '', value },
              }
            : payment,
        ),
      };
      return part === 'amount' || part === 'currency' ? withSyncedHeaderTotal(next) : next;
    });
  };

  const closeEdit = () => {
    setEditTarget(null);
    setAddingCustomer(false);
  };

  const addErrorType = () => {
    const label = String(newType || '').trim();
    if (!isListedErrorType(label)) return;
    const existing = typeOptions.find((option) => option.label.toLowerCase() === label.toLowerCase());
    const next = existing?.label || label;
    if (!existing) {
      setExtraTypes((current) => [...current, next]);
    }
    setErrorType(next);
    setNewType('');
    setAddingType(false);
    setTypeQuery('');
  };

  const finish = () => {
    if (!activeRow || !draft) return;
    onSave?.(activeRow.id, buildReview(activeRow, draft, { note, errorType, errorAmount, images }));
    onClose?.();
  };

  if (!mounted || !heldRow) return null;

  const title = step === 'note' ? 'Error' : heldRow.reference || 'Edit';
  const changedCount = corrections.length;
  const header = Array.isArray(draft?.header) ? draft.header : [];
  const items = Array.isArray(draft?.items) ? draft.items : [];
  const payments = Array.isArray(draft?.payments) ? draft.payments : [];
  const editingItem =
    editTarget?.type === 'item' ? items.find((item) => item.id === editTarget.id) : null;
  const editingPayment =
    editTarget?.type === 'payment'
      ? payments.find((payment) => payment.id === editTarget.id)
      : null;
  const headerEditing = editTarget?.type === 'header' ? headerField(editTarget.key) : null;
  const showPaymentTill = payments.some((payment) => fieldHasText(payment.till));
  const showPaymentNotes = payments.some((payment) => fieldHasText(payment.notes));
  const editTitle =
    editTarget?.type === 'header'
      ? `Edit ${headerEditing?.label || 'field'}`
      : editTarget?.type === 'item'
        ? `Edit ${ITEM_COLUMNS.find((column) => column.key === editTarget.column)?.label || 'item'}`
        : editTarget?.type === 'payment'
          ? `Edit ${PAYMENT_COLUMNS.find((column) => column.key === editTarget.column)?.label || 'payment'}`
          : 'Edit';

  return (
    <>
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
      onRight={
        step === 'edit'
          ? () => {
              closeEdit();
              setStep('note');
            }
          : finish
      }
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
          <Ionicons name="image-outline" size={18} color="#C2410C" />
          <Text style={styles.addImageBtnText}>Add image</Text>
        </Pressable>
      }
      widthRatio={step === 'note' && !isMobile ? 0.88 : 0.78}
      minWidth={step === 'note' && !isMobile ? 920 : 720}
      coloredNav
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
              <Text style={[styles.groupHeader, styles.groupHeaderFirst]}>Details</Text>
              <View style={styles.detailsCard}>
                {header.map((field, index) => {
                  const buyer =
                    field.key === 'employee'
                      ? findStaffByEmployeeName(staffProfiles, field.value)
                      : null;
                  return (
                    <View
                      key={field.key}
                      style={[
                        styles.detailReadRow,
                        index === header.length - 1 && styles.detailReadRowLast,
                      ]}
                    >
                      <Text style={styles.detailReadLabel} numberOfLines={1}>
                        {field.label}
                      </Text>
                      {field.key === 'employee' ? (
                        <View style={styles.detailPerson}>
                          <StaffAvatar
                            uri={buyer?.avatarUrl || ''}
                            name={field.value || 'Employee'}
                            size={24}
                          />
                          <ReadValue field={field} />
                        </View>
                      ) : (
                        <ReadValue field={field} />
                      )}
                      <EditButton
                        label={`Edit ${field.label}`}
                        onPress={() => {
                          setAddingCustomer(false);
                          setEditTarget({ type: 'header', key: field.key });
                        }}
                      />
                    </View>
                  );
                })}
              </View>

              <Text style={styles.groupHeader}>Items</Text>
              {items.length === 0 ? (
                <View style={[styles.dataTable, styles.itemsTable]}>
                  <Text style={styles.emptyText}>No line items</Text>
                </View>
              ) : (
                <View style={[styles.dataTable, styles.itemsTable]}>
                    <View style={styles.dataTableHead}>
                      <View style={styles.colPhoto} />
                      <Text style={[styles.dataTableHeadText, styles.colProduct]}>Product</Text>
                      <Text style={[styles.dataTableHeadText, styles.colQty]}>Qty</Text>
                      <Text style={[styles.dataTableHeadText, styles.colDelivered]}>Delivered</Text>
                      <Text style={[styles.dataTableHeadText, styles.colUnit]}>Unit cost</Text>
                      <Text style={[styles.dataTableHeadText, styles.colAmount]}>Amount</Text>
                      <View style={styles.colEdit} />
                    </View>
                    {items.map((item, index) => (
                      <View
                        key={item.id}
                        style={[styles.dataTableRow, index === items.length - 1 && styles.dataTableRowLast]}
                      >
                        <View style={styles.colPhoto}>
                          <PoThumb urls={item.imageUrls} label={item.name?.value || 'Item'} />
                        </View>
                        <View style={styles.colProduct}>
                          <ReadValue field={item.name} />
                        </View>
                        <View style={styles.colQty}>
                          <ReadValue field={item.qty} suffix={item.unitType || 'ea'} />
                        </View>
                        <View style={styles.colDelivered}>
                          <Text style={styles.readValue} numberOfLines={1}>
                            {item.deliveredLabel || '—'}
                          </Text>
                        </View>
                        <View style={styles.colUnit}>
                          <ReadValue
                            field={item.unit}
                            suffix={item.unitType && item.unitType !== 'ea' ? `/${item.unitType}` : null}
                          />
                        </View>
                        <View style={styles.colAmount}>
                          <ReadValue field={item.amount} />
                        </View>
                        <View style={styles.colEdit}>
                          <EditButton
                            label={`Edit ${item.name?.value || 'item'}`}
                            onPress={() => setEditTarget({ type: 'item', id: item.id, column: 'name' })}
                          />
                        </View>
                      </View>
                    ))}
                </View>
              )}

              <Text style={styles.groupHeader}>Payments</Text>
              {payments.length === 0 ? (
                <View style={styles.dataTable}>
                  <Text style={styles.emptyText}>No payments</Text>
                </View>
              ) : (
                <ScrollView
                  horizontal
                  style={styles.tableHScroll}
                  contentContainerStyle={styles.tableHContent}
                  showsHorizontalScrollIndicator={false}
                >
                  <View style={[styles.dataTable, styles.paymentsTable]}>
                    <View style={styles.dataTableHead}>
                      <Text style={[styles.dataTableHeadText, styles.colMethod]}>Method</Text>
                      {showPaymentTill ? (
                        <Text style={[styles.dataTableHeadText, styles.colTill]}>Till</Text>
                      ) : null}
                      <Text style={[styles.dataTableHeadText, styles.colCurrency]}>Currency</Text>
                      <Text style={[styles.dataTableHeadText, styles.colPayAmount]}>Amount</Text>
                      {showPaymentNotes ? (
                        <Text style={[styles.dataTableHeadText, styles.colPayNotes]}>Notes</Text>
                      ) : null}
                      <View style={styles.colEdit} />
                    </View>
                    {payments.map((payment, index) => (
                        <View
                          key={payment.id}
                          style={[
                            styles.dataTableRow,
                            index === payments.length - 1 && styles.dataTableRowLast,
                          ]}
                        >
                          <View style={styles.colMethod}>
                            <ReadValue field={payment.method} />
                          </View>
                          {showPaymentTill ? (
                            <View style={styles.colTill}>
                              <ReadValue field={payment.till} />
                            </View>
                          ) : null}
                          <View style={styles.colCurrency}>
                            <ReadValue field={payment.currency} />
                          </View>
                          <View style={styles.colPayAmount}>
                            <ReadValue field={payment.amount} />
                          </View>
                          {showPaymentNotes ? (
                            <View style={styles.colPayNotes}>
                              <ReadValue field={payment.notes} />
                            </View>
                          ) : null}
                          <View style={styles.colEdit}>
                            <EditButton
                              label={`Edit ${payment.method?.value || 'payment'}`}
                              onPress={() =>
                                setEditTarget({ type: 'payment', id: payment.id, column: 'method' })
                              }
                            />
                          </View>
                        </View>
                    ))}
                  </View>
                </ScrollView>
              )}
            </ScrollView>
          ) : isMobile ? (
            <ScrollView
              style={styles.body}
              contentContainerStyle={[styles.editContent, styles.editContentMobile]}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <PurchaseSummary
                header={header}
                items={items}
                payments={payments}
                staffProfiles={staffProfiles}
                showPaymentTill={showPaymentTill}
                showPaymentNotes={showPaymentNotes}
                changedCount={changedCount}
              />
              <ErrorReportFields
                note={note}
                setNote={setNote}
                images={images}
                setImages={setImages}
                isMobile
                typeQuery={typeQuery}
                setTypeQuery={setTypeQuery}
                visibleTypeOptions={visibleTypeOptions}
                errorType={errorType}
                setErrorType={setErrorType}
                addingType={addingType}
                newType={newType}
                setNewType={setNewType}
                addErrorType={addErrorType}
                setAddingType={setAddingType}
              />
            </ScrollView>
          ) : (
            <View style={styles.noteSplit}>
              <ScrollView
                style={styles.notePane}
                contentContainerStyle={styles.notePaneContent}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                <PurchaseSummary
                  header={header}
                  items={items}
                  payments={payments}
                  staffProfiles={staffProfiles}
                  showPaymentTill={showPaymentTill}
                  showPaymentNotes={showPaymentNotes}
                  changedCount={changedCount}
                />
              </ScrollView>
              <View style={styles.noteSplitRule} />
              <ScrollView
                style={styles.notePane}
                contentContainerStyle={styles.notePaneContent}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                <ErrorReportFields
                  note={note}
                  setNote={setNote}
                  images={images}
                  setImages={setImages}
                  firstHeader
                  typeQuery={typeQuery}
                  setTypeQuery={setTypeQuery}
                  visibleTypeOptions={visibleTypeOptions}
                  errorType={errorType}
                  setErrorType={setErrorType}
                  addingType={addingType}
                  newType={newType}
                  setNewType={setNewType}
                  addErrorType={addErrorType}
                  setAddingType={setAddingType}
                />
              </ScrollView>
            </View>
          )}
    </TriageDrawer>
      <TriageCorrectionImages
        ref={imagesRef}
        images={images}
        onChange={setImages}
        pickerOnly
      />
      {editTarget ? (
      <Modal visible transparent animationType="fade" onRequestClose={closeEdit}>
        <View style={styles.editModalRoot}>
          <Pressable style={StyleSheet.absoluteFill} onPress={closeEdit} accessibilityLabel="Close editor" />
          <View style={[styles.editModalSheet, isMobile && styles.editModalSheetMobile]}>
            <View style={styles.editModalBar}>
              <Pressable
                onPress={closeEdit}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Cancel"
                style={styles.editModalBarSide}
              >
                <Text style={styles.editModalCancel}>Cancel</Text>
              </Pressable>
              <Text style={styles.editModalTitle} numberOfLines={1}>
                {editTitle}
              </Text>
              <Pressable
                onPress={closeEdit}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Done"
                style={[styles.editModalBarSide, styles.editModalBarSideRight]}
              >
                <Text style={styles.editModalDone}>Done</Text>
              </Pressable>
            </View>
            {editTarget?.type === 'item' ? (
              <ColumnChips
                columns={ITEM_COLUMNS}
                value={editTarget.column}
                onChange={(column) => setEditTarget((current) => (current ? { ...current, column } : current))}
              />
            ) : null}
            {editTarget?.type === 'payment' ? (
              <ColumnChips
                columns={PAYMENT_COLUMNS}
                value={editTarget.column}
                onChange={(column) => setEditTarget((current) => (current ? { ...current, column } : current))}
              />
            ) : null}
            <ScrollView
              style={styles.editModalBody}
              contentContainerStyle={styles.editModalBodyContent}
              keyboardShouldPersistTaps="handled"
              nestedScrollEnabled
            >
              {editTarget?.type === 'header' && headerEditing ? (
                addingCustomer && editTarget.key === 'customer' ? (
                  <NewCustomerPanel
                    onCancel={() => setAddingCustomer(false)}
                    onCreated={(created) => {
                      updateHeader('customer', created.label);
                      setAddingCustomer(false);
                    }}
                  />
                ) : editTarget.key === 'customer' ? (
                  <LookupField
                    label={headerEditing.label}
                    field={headerEditing}
                    onSearch={searchCustomerOptions}
                    onChange={(value) => updateHeader('customer', value)}
                    placeholder="Search customers"
                    last
                    rightAction={
                      <Pressable
                        style={styles.addIconButton}
                        onPress={() => setAddingCustomer(true)}
                        accessibilityLabel="New customer"
                      >
                        <Ionicons name="add-circle-outline" size={18} color={TEXT} />
                      </Pressable>
                    }
                  />
                ) : editTarget.key === 'store' ? (
                  <LookupField
                    label="Store"
                    field={headerEditing}
                    options={locations}
                    pickOnly
                    onChange={(value) => updateHeader('store', value)}
                    placeholder="Select a store"
                    last
                  />
                ) : editTarget.key === 'employee' ? (
                  <LookupField
                    label="Employee"
                    field={headerEditing}
                    options={employees}
                    pickOnly
                    onChange={(value) => updateHeader('employee', value)}
                    placeholder="Select an employee"
                    last
                  />
                ) : editTarget.key === 'total' ? (
                  payments.length ? (
                    <>
                      {payments.map((payment, index) => (
                        <CorrectableField
                          key={payment.id}
                          label={paymentTypeLabel(payment)}
                          field={payment.amount}
                          onChange={(value) => updatePayment(payment.id, 'amount', value)}
                          keyboardType="decimal-pad"
                          last={index === payments.length - 1 && payments.length === 1}
                        />
                      ))}
                      {payments.length > 1 ? (
                        <View style={[styles.iosRowWrap, styles.iosRowLast]}>
                          <View style={styles.iosRow}>
                            <Text style={styles.iosRowLabel}>Total</Text>
                            <Text style={styles.totalPreviewValue} numberOfLines={1}>
                              {headerField('total')?.value || '—'}
                            </Text>
                          </View>
                        </View>
                      ) : null}
                    </>
                  ) : (
                    <CorrectableField
                      label={headerEditing.label}
                      field={headerEditing}
                      onChange={(value) => updateHeader('total', value)}
                      keyboardType="decimal-pad"
                      last
                    />
                  )
                ) : (
                  <CorrectableField
                    label={headerEditing.label}
                    field={headerEditing}
                    onChange={(value) => updateHeader(editTarget.key, value)}
                    last
                  />
                )
              ) : null}

              {editTarget?.type === 'item' && editingItem && editTarget.column === 'name' ? (
                <LookupField
                  label="Product"
                  field={editingItem.name}
                  options={pricingOptions}
                  filterOptions={(list, query) =>
                    filterCatalogProductOptions(list, query, editingItem.name.original)
                  }
                  onSearch={searchProductOptions}
                  allowCustom
                  onChange={(value) => updateItem(editingItem.id, 'name', value)}
                  placeholder="Search product"
                  last
                />
              ) : null}
              {editTarget?.type === 'item' && editingItem && editTarget.column === 'qty' ? (
                <>
                  <CorrectableField
                    label="Qty"
                    field={editingItem.qty}
                    suffix={editingItem.unitType || 'ea'}
                    onChange={(value) => updateItem(editingItem.id, 'qty', value)}
                    keyboardType="decimal-pad"
                  />
                  <ItemTotalsPreview
                    item={editingItem}
                    headerTotal={headerField('total')}
                    payments={payments}
                    includeAmount
                  />
                </>
              ) : null}
              {editTarget?.type === 'item' && editingItem && editTarget.column === 'unit' ? (
                <>
                  <CorrectableField
                    label="Unit cost"
                    field={editingItem.unit}
                    suffix={
                      editingItem.unitType && editingItem.unitType !== 'ea'
                        ? `/${editingItem.unitType}`
                        : null
                    }
                    onChange={(value) => updateItem(editingItem.id, 'unit', value)}
                    keyboardType="decimal-pad"
                  />
                  <ItemTotalsPreview
                    item={editingItem}
                    headerTotal={headerField('total')}
                    payments={payments}
                    includeAmount
                  />
                </>
              ) : null}
              {editTarget?.type === 'item' && editingItem && editTarget.column === 'amount' ? (
                <>
                  <CorrectableField
                    label="Amount"
                    field={editingItem.amount}
                    onChange={(value) => updateItem(editingItem.id, 'amount', value)}
                    keyboardType="decimal-pad"
                  />
                  <ItemTotalsPreview
                    item={editingItem}
                    headerTotal={headerField('total')}
                    payments={payments}
                  />
                </>
              ) : null}

              {editTarget?.type === 'payment' && editingPayment && editTarget.column === 'method' ? (
                <CorrectableField
                  label="Method"
                  field={editingPayment.method}
                  onChange={(value) => updatePayment(editingPayment.id, 'method', value)}
                  last
                />
              ) : null}
              {editTarget?.type === 'payment' && editingPayment && editTarget.column === 'till' ? (
                <CorrectableField
                  label="Till"
                  field={editingPayment.till || { original: '', value: '' }}
                  onChange={(value) => updatePayment(editingPayment.id, 'till', value)}
                  last
                />
              ) : null}
              {editTarget?.type === 'payment' && editingPayment && editTarget.column === 'currency' ? (
                <LookupField
                  label="Currency"
                  field={editingPayment.currency || { original: 'CAD', value: 'CAD' }}
                  options={CURRENCY_OPTIONS}
                  pickOnly
                  onChange={(value) => updatePayment(editingPayment.id, 'currency', value)}
                  placeholder="Select currency"
                  last
                />
              ) : null}
              {editTarget?.type === 'payment' && editingPayment && editTarget.column === 'amount' ? (
                <CorrectableField
                  label="Amount"
                  field={editingPayment.amount}
                  onChange={(value) => updatePayment(editingPayment.id, 'amount', value)}
                  keyboardType="decimal-pad"
                  last
                />
              ) : null}
              {editTarget?.type === 'payment' && editingPayment && editTarget.column === 'notes' ? (
                <CorrectableField
                  label="Notes"
                  field={editingPayment.notes || { original: '', value: '' }}
                  onChange={(value) => updatePayment(editingPayment.id, 'notes', value)}
                  last
                />
              ) : null}
            </ScrollView>
          </View>
        </View>
      </Modal>
      ) : null}
    </>
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
    gap: 6,
    minHeight: 34,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: '#fff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(194,65,12,0.22)',
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
    color: '#C2410C',
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
  groupHeaderFirst: {
    marginTop: 0,
  },
  paneCard: {
    alignSelf: 'stretch',
    maxWidth: '100%',
  },
  summaryMeta: {
    fontFamily,
    fontSize: 13,
    color: SECONDARY,
    marginTop: -4,
    marginBottom: 8,
  },
  noteSplit: {
    flex: 1,
    minHeight: 0,
    flexDirection: 'row',
  },
  notePane: {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
  },
  notePaneContent: {
    paddingHorizontal: 22,
    paddingTop: 16,
    paddingBottom: 40,
  },
  noteSplitRule: {
    width: StyleSheet.hairlineWidth,
    backgroundColor: HAIRLINE,
    alignSelf: 'stretch',
  },
  detailsCard: {
    alignSelf: 'flex-start',
    width: '100%',
    maxWidth: 520,
    backgroundColor: '#fff',
    borderRadius: 10,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: HAIRLINE,
  },
  typeSearchWrap: {
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: HAIRLINE,
  },
  typeSearch: {
    width: '100%',
  },
  typeSearchEmpty: {
    fontFamily,
    fontSize: 13,
    color: SECONDARY,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: HAIRLINE,
  },
  detailReadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 36,
    paddingHorizontal: 10,
    paddingVertical: 6,
    gap: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: HAIRLINE,
  },
  detailReadRowLast: {
    borderBottomWidth: 0,
  },
  optionRowOn: {
    backgroundColor: '#FFF6EE',
  },
  optionLabel: {
    fontFamily,
    flex: 1,
    minWidth: 0,
    fontSize: 14,
    color: TEXT,
    paddingHorizontal: 8,
  },
  optionLabelOn: {
    fontWeight: '600',
    color: '#C2410C',
  },
  optionCount: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: SECONDARY,
    minWidth: 24,
    textAlign: 'right',
  },
  optionCountOn: {
    color: '#C2410C',
  },
  optionAddInput: {
    fontFamily,
    flex: 1,
    minWidth: 0,
    fontSize: 14,
    color: TEXT,
    paddingHorizontal: 8,
    outlineStyle: 'none',
  },
  optionAddBtn: {
    paddingHorizontal: 4,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  optionAddCancel: {
    fontFamily,
    fontSize: 14,
    color: SECONDARY,
  },
  optionAddDone: {
    fontFamily,
    fontSize: 14,
    fontWeight: '600',
    color: T.blue,
  },
  optionAddLink: {
    fontFamily,
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: T.blue,
  },
  photoCard: {
    padding: 12,
  },
  noteCardInput: {
    fontFamily,
    fontSize: 14,
    lineHeight: 20,
    color: TEXT,
    minHeight: 88,
    paddingHorizontal: 12,
    paddingVertical: 10,
    outlineStyle: 'none',
  },
  detailReadLabel: {
    fontFamily,
    width: 128,
    flexShrink: 0,
    fontSize: 13,
    fontWeight: '500',
    color: SECONDARY,
  },
  readValue: {
    fontFamily,
    flex: 1,
    minWidth: 0,
    fontSize: 14,
    color: TEXT,
    paddingHorizontal: 8,
  },
  readValueChangedCol: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: 8,
    gap: 1,
  },
  readValueStruck: {
    fontFamily,
    fontSize: 12,
    lineHeight: 16,
    color: STRUCK,
    textDecorationLine: 'line-through',
    ...Platform.select({
      web: { textDecoration: 'line-through' },
      default: {},
    }),
  },
  readValueChanged: {
    fontFamily,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '600',
    color: '#C2410C',
  },
  detailPerson: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  editBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  cellWrap: {
    minWidth: 0,
  },
  compactDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: HAIRLINE,
  },
  cellRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 32,
    paddingHorizontal: 10,
    paddingVertical: 3,
    gap: 8,
  },
  compactLabel: {
    fontFamily,
    width: 72,
    flexShrink: 0,
    fontSize: 13,
    fontWeight: '500',
    color: SECONDARY,
  },
  cellControl: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  compactInput: {
    fontSize: 14,
    textAlign: 'left',
    paddingVertical: 2,
  },
  valueRowCompact: {
    justifyContent: 'flex-start',
  },
  changedRowCompact: {
    justifyContent: 'flex-start',
  },
  changedOriginalCompact: {
    flex: 1,
    minWidth: 0,
    textAlign: 'left',
  },
  tableHScroll: {
    flexGrow: 0,
  },
  tableHContent: {
    flexGrow: 1,
    minWidth: '100%',
  },
  dataTable: {
    backgroundColor: '#fff',
    borderRadius: 10,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: HAIRLINE,
  },
  itemsTable: {
    alignSelf: 'center',
    width: '100%',
    maxWidth: '100%',
  },
  paymentsTable: {
    alignSelf: 'flex-start',
    width: '100%',
    maxWidth: '100%',
    minWidth: 520,
  },
  dataTableHead: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 30,
    paddingHorizontal: 8,
    backgroundColor: '#f6f6f9',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: HAIRLINE,
    borderTopLeftRadius: 10,
    borderTopRightRadius: 10,
  },
  dataTableHeadText: {
    fontFamily,
    fontSize: 11,
    fontWeight: '600',
    color: SECONDARY,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
    paddingHorizontal: 10,
  },
  dataTableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: HAIRLINE,
  },
  dataTableRowLast: {
    borderBottomWidth: 0,
  },
  colPhoto: {
    width: 46,
    flexGrow: 0,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  colProduct: {
    flex: 2.4,
    minWidth: 0,
    justifyContent: 'center',
  },
  colQty: {
    flex: 0.85,
    minWidth: 0,
    justifyContent: 'center',
  },
  colDelivered: {
    flex: 0.95,
    minWidth: 0,
    justifyContent: 'center',
  },
  colUnit: {
    flex: 1.05,
    minWidth: 0,
    justifyContent: 'center',
  },
  colAmount: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
  },
  colEdit: {
    width: 40,
    flexGrow: 0,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  colMethod: {
    flex: 1.1,
    minWidth: 120,
    justifyContent: 'center',
  },
  colTill: {
    width: 110,
    flexGrow: 0,
    flexShrink: 0,
    justifyContent: 'center',
  },
  colCurrency: {
    width: 84,
    flexGrow: 0,
    flexShrink: 0,
    justifyContent: 'center',
  },
  colPayAmount: {
    width: 108,
    flexGrow: 0,
    flexShrink: 0,
    justifyContent: 'center',
  },
  colPayNotes: {
    flex: 1.2,
    minWidth: 140,
    justifyContent: 'center',
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
    ...Platform.select({
      web: { textDecoration: 'line-through' },
      default: {},
    }),
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
  editModalRoot: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.32)',
    padding: 24,
  },
  editModalSheet: {
    width: '100%',
    maxWidth: 520,
    maxHeight: '86%',
    backgroundColor: '#fff',
    borderRadius: 14,
    overflow: 'hidden',
    zIndex: 2,
    ...Platform.select({
      web: { boxShadow: '0 16px 40px rgba(0,0,0,0.18)' },
      default: { elevation: 8 },
    }),
  },
  editModalSheetMobile: {
    maxWidth: '100%',
    maxHeight: '92%',
  },
  editModalBar: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 48,
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: HAIRLINE,
    backgroundColor: '#FFF1E4',
  },
  editModalBarSide: {
    width: 72,
    justifyContent: 'center',
  },
  editModalBarSideRight: {
    alignItems: 'flex-end',
  },
  editModalCancel: {
    fontFamily,
    fontSize: 16,
    color: '#C2410C',
  },
  editModalDone: {
    fontFamily,
    fontSize: 16,
    fontWeight: '600',
    color: '#007AFF',
  },
  editModalTitle: {
    flex: 1,
    fontFamily,
    fontSize: 16,
    fontWeight: '600',
    color: TEXT,
    textAlign: 'center',
  },
  columnChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: HAIRLINE,
  },
  columnChip: {
    minHeight: 30,
    paddingHorizontal: 12,
    borderRadius: 16,
    backgroundColor: '#f2f2f7',
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  columnChipOn: {
    backgroundColor: '#007AFF',
  },
  columnChipText: {
    fontFamily,
    fontSize: 13,
    fontWeight: '500',
    color: TEXT,
  },
  columnChipTextOn: {
    color: '#fff',
  },
  editModalBody: {
    maxHeight: 420,
  },
  editModalBodyContent: {
    paddingVertical: 8,
    paddingBottom: 20,
  },
  totalPreviewValue: {
    fontFamily,
    flex: 1,
    minWidth: 0,
    fontSize: 17,
    fontWeight: '600',
    color: TEXT,
    textAlign: 'right',
  },
});
