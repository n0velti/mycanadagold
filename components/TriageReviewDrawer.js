import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
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
  formatAmount,
  formatPickerDate,
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
  makeField,
  MAX_REVIEW_IMAGES,
  normalizeDraft,
  normalizeReviewImages,
  rankLabeledCounts,
  VISIBLE_ERROR_TYPE_LIMIT,
  withItemPartUpdated,
  withSyncedHeaderTotal,
  withSyncedTotalsFromItems,
} from '../lib/triageDraft';
import TriageCorrectionImages from './TriageCorrectionImages';
import { FONT, T, TextAction, TriageDrawer, SearchField, StaffAvatar, useHeldValue } from './TriageKit';
import { PoThumb } from './TriageTable';
import { MOBILE, mobileSafeTop, useIsMobile } from '../lib/mobileUi';
import {
  fetchLookupLocations,
  fetchLookupUsers,
  mergeEmployeeOptions,
  searchClients,
  searchProducts,
} from '../lib/triageLookups';
import { catalogProductOptions, fetchWebsitePrices } from '../lib/websitePrices';
import { findStaffByEmployeeName, listStaffProfiles } from '../lib/permissions';
import { triageReviewEditKey, useTransferWorkflow } from '../lib/transferWorkflow';
import {
  applyDate,
  applyTime,
  BuyItemsReviewTable,
  BuyTicketBar,
  emptyPayment,
  normalizePayoutMethod,
  parseTicketDate,
  PaymentMethodModal,
} from './BuyTicketKit';

const fontFamily = FONT;
const TEXT = T.text;
const SECONDARY = T.secondary;
const HAIRLINE = T.hairline;
const STRUCK = T.secondary;
const MOBILE_BREAKPOINT = 768;
const BUY_ACCENT = '#1F8A4E';
const BUY_TINT = '#EAF6EE';
const TRIAGE_STEPS = [
  { id: 'details', label: 'Details' },
  { id: 'reporting', label: 'Reporting' },
  { id: 'finish', label: 'Finish' },
];

function fieldHasText(field) {
  return Boolean(String(field?.value || field?.original || '').trim());
}

function parseMoneyLabel(value) {
  const n = Number(String(value || '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function stripMoney(value) {
  return String(value || '').replace(/[^0-9.-]/g, '');
}

function toBuyPayments(payments) {
  return (payments || []).map((payment) => {
    const method = normalizePayoutMethod(payment.method?.value);
    const notes = String(payment.notes?.value || '').trim();
    const till = String(payment.till?.value || '').trim();
    return {
      id: payment.id,
      method,
      amount: stripMoney(payment.amount?.value),
      notes: notes && till && notes !== till ? `${notes} · ${till}` : notes || till,
    };
  });
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

function CorrectableField({ label, field, onChange, keyboardType, last, suffix, compact, bare, skin, boxed, right }) {
  const ticket = skin === 'ticket';
  const stacked = useIsMobile() && !compact && !ticket;
  const changed = fieldChanged(field);
  const reverse = () => onChange(field.original ?? '');
  const input = (
    <>
      <ChangedOriginal field={field} onReverse={reverse} compact={compact || ticket} />
      <View
        style={[
          boxed ? styles.qtyBox : styles.valueRow,
          compact && styles.valueRowCompact,
          ticket && !boxed && styles.ticketValueRow,
        ]}
      >
        <TextInput
          style={[
            styles.iosRowInput,
            stacked && styles.iosRowInputStacked,
            compact && styles.compactInput,
            compact && right && styles.compactInputRight,
            ticket && styles.ticketInput,
            boxed && styles.qtyBoxInput,
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
        {suffix ? <Text style={[styles.unitLock, boxed && styles.qtyBoxSuffix]}>{suffix}</Text> : null}
      </View>
    </>
  );
  if (ticket) {
    return (
      <View style={[styles.ticketRow, last && styles.ticketRowLast]}>
        {label ? <Text style={styles.ticketLabel}>{label}</Text> : null}
        <View style={styles.ticketControl}>{input}</View>
      </View>
    );
  }
  return (
    <View
      style={[
        compact ? styles.cellWrap : styles.iosRowWrap,
        last && styles.iosRowLast,
        compact && !bare && !last && styles.compactDivider,
      ]}
    >
      <View style={[compact ? styles.cellRow : styles.iosRow, stacked && styles.iosRowStacked]}>
        {label ? (
          <Text style={[compact ? styles.compactLabel : styles.iosRowLabel, stacked && styles.iosRowLabelStacked]}>
            {label}
          </Text>
        ) : null}
        <View style={compact ? styles.cellControl : styles.iosRowControl}>{input}</View>
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
  trailing,
  last,
  compact,
  bare,
  skin,
  wideMenu,
}) {
  const ticket = skin === 'ticket';
  const stacked = useIsMobile() && !compact && !ticket;
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

  const control = (
    <>
      <ChangedOriginal field={field} onReverse={reverse} compact={compact || ticket} />
      <View style={[styles.lookupRow, ticket && styles.ticketValueRow]}>
        <View style={styles.lookupInputWrap}>
          <TextInput
            style={[
              styles.iosRowInput,
              stacked && styles.iosRowInputStacked,
              compact && styles.compactInput,
              ticket && styles.ticketInput,
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
        {trailing}
        {compact || ticket ? null : <Ionicons name="chevron-forward" size={16} color="#c7c7cc" />}
        {rightAction}
      </View>
    </>
  );
  const menu = open ? (
    <ScrollView
      style={[styles.lookupMenu, (ticket || compact) && styles.ticketMenu, wideMenu && styles.ticketMenuWide]}
      keyboardShouldPersistTaps="handled"
      nestedScrollEnabled
    >
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
            style={[styles.lookupOption, option.avatarUrl != null && styles.lookupOptionPerson]}
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
            {option.avatarUrl != null || option.person ? (
              <StaffAvatar uri={option.avatarUrl || ''} name={option.label} size={22} />
            ) : null}
            <View style={styles.lookupOptionCopy}>
              <Text style={styles.lookupOptionLabel} numberOfLines={1}>
                {option.label}
              </Text>
              {option.sub ? (
                <Text style={styles.lookupOptionSub} numberOfLines={1}>
                  {option.sub}
                </Text>
              ) : null}
            </View>
          </Pressable>
        ))
      )}
    </ScrollView>
  ) : null;

  if (ticket) {
    return (
      <View style={[styles.ticketRow, last && styles.ticketRowLast, open && styles.ticketRowRaised, styles.lookupBlock]}>
        {label ? <Text style={styles.ticketLabel}>{label}</Text> : null}
        <View style={styles.ticketControl}>
          {control}
          {menu}
        </View>
      </View>
    );
  }

  return (
    <View
      style={[
        compact ? styles.cellWrap : styles.iosRowWrap,
        last && styles.iosRowLast,
        compact && !bare && !last && styles.compactDivider,
        styles.lookupBlock,
        compact && open && styles.ticketRowRaised,
      ]}
    >
      <View style={[compact ? styles.cellRow : styles.iosRow, stacked && styles.iosRowStacked]}>
        {label ? (
          <Text style={[compact ? styles.compactLabel : styles.iosRowLabel, stacked && styles.iosRowLabelStacked]}>
            {label}
          </Text>
        ) : null}
        <View style={compact ? styles.cellControl : styles.iosRowControl}>{control}</View>
      </View>
      {menu}
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

function CapturedPreview({ uri, count, onPress }) {
  if (!uri) return null;
  return (
    <Pressable
      onPress={onPress}
      style={styles.capturedPreview}
      accessibilityRole="button"
      accessibilityLabel={count > 1 ? `View ${count} captured photos` : 'View captured photo'}
    >
      <Image source={{ uri }} style={styles.capturedPreviewImage} />
      {count > 1 ? (
        <View style={styles.capturedPreviewBadge} pointerEvents="none">
          <Text style={styles.capturedPreviewBadgeText}>{count > 9 ? '9+' : count}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

function CapturedPhotoStrip({ images, onChange, readOnly = false, compact = false, inset = true }) {
  if (!images.length) return null;
  return (
    <View style={inset ? styles.capturedStrip : styles.capturedStripFlush}>
      <View style={styles.itemsToolbar}>
        <Text style={styles.itemsTitle}>Photos</Text>
        <Text style={styles.summaryMetaInline}>Tap a photo to view it</Text>
      </View>
      <View style={[styles.detailsCard, styles.photoCard, styles.paneCard]}>
        <TriageCorrectionImages
          images={images}
          onChange={onChange}
          readOnly={readOnly}
          compact={compact}
          hideHeading
          hideActions
        />
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

  const [stepIndex, setStepIndex] = useState(0);
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
  const [openKey, setOpenKey] = useState('');
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [orderType, setOrderType] = useState('Standard');
  const [ticketStatus, setTicketStatus] = useState('Completed');
  const [occurredAt, setOccurredAt] = useState(() => new Date());
  const [customerHits, setCustomerHits] = useState([]);
  const [customerBusy, setCustomerBusy] = useState(false);
  const imagesRef = useRef(null);
  const detailRequestId = useRef(0);
  const openedIdRef = useRef(null);
  const baselineKeyRef = useRef('');
  const rowRef = useRef(row);
  const reviewRef = useRef(review);
  const sessionRef = useRef(session);
  const onHydrateRef = useRef(onHydrate);
  rowRef.current = row;
  reviewRef.current = review;
  sessionRef.current = session;
  onHydrateRef.current = onHydrate;

  const rememberBaseline = (nextDraft, extras = {}) => {
    baselineKeyRef.current = triageReviewEditKey({
      draft: nextDraft,
      note: extras.note || '',
      errorType: extras.errorType || '',
      errorAmount: extras.errorAmount || '',
      images: extras.images || [],
    });
  };

  const reset = useCallback(() => {
    baselineKeyRef.current = '';
    setStepIndex(0);
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
    setStepIndex(0);
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
      const nextNote = existingReview.note || '';
      const nextType = isListedErrorType(existingReview.errorType) ? existingReview.errorType : '';
      const nextAmount = formatErrorAmount(existingReview.errorAmount);
      const nextImages = normalizeReviewImages(existingReview.images);
      let nextDraft;
      try {
        nextDraft = normalizeDraft(existingReview.draft);
        setDraft(nextDraft);
        setDetailError('');
      } catch (err) {
        nextDraft = safeDraft(current, null);
        setDraft(nextDraft);
        setDetailError(err?.message || 'Could not read saved edits.');
      }
      setNote(nextNote);
      setErrorType(nextType);
      setErrorAmount(nextAmount);
      setImages(nextImages);
      rememberBaseline(nextDraft, {
        note: nextNote,
        errorType: nextType,
        errorAmount: nextAmount,
        images: nextImages,
      });
      setDetailLoading(false);
      return;
    }

    const preliminary = safeDraft(current, null);
    setDraft(preliminary);
    setNote('');
    setErrorType('');
    setErrorAmount('');
    setImages([]);
    rememberBaseline(preliminary);
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
          const nextDraft = safeDraft(enriched, detail);
          setActiveRow(enriched);
          setDraft(nextDraft);
          rememberBaseline(nextDraft);
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
    if (!visible || !activeRow) return;
    setOpenKey('');
    setPaymentModalOpen(false);
    setOrderType('Standard');
    setTicketStatus('Completed');
    setOccurredAt(parseTicketDate(activeRow.dateLabel));
  }, [activeRow?.id, visible]);

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

  useEffect(() => {
    if (openKey !== 'customer') {
      setCustomerHits([]);
      setCustomerBusy(false);
      return undefined;
    }
    const query = String((draft?.header || []).find((field) => field.key === 'customer')?.value || '').trim();
    if (query.length < 2) {
      setCustomerHits([]);
      setCustomerBusy(false);
      return undefined;
    }
    let cancelled = false;
    setCustomerBusy(true);
    const timer = setTimeout(() => {
      searchCustomerOptions(query)
        .then((rows) => {
          if (!cancelled) setCustomerHits(rows || []);
        })
        .catch(() => {
          if (!cancelled) setCustomerHits([]);
        })
        .finally(() => {
          if (!cancelled) setCustomerBusy(false);
        });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [openKey, draft, searchCustomerOptions]);

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

  const applyBuyPayments = (updater) => {
    setDraft((current) => {
      if (!current) return current;
      const currentBuy = toBuyPayments(current.payments);
      const nextBuy = typeof updater === 'function' ? updater(currentBuy) : updater;
      const prevById = new Map((current.payments || []).map((row) => [row.id, row]));
      const payments = (nextBuy || []).map((row) => {
        const prev = prevById.get(row.id);
        if (!prev) {
          return {
            id: row.id,
            method: makeField(row.method),
            till: makeField(''),
            currency: makeField('CAD'),
            amount: makeField(row.amount),
            notes: makeField(row.notes),
          };
        }
        return {
          ...prev,
          method: { ...(prev.method || makeField('')), value: row.method },
          amount: { ...(prev.amount || makeField('')), value: row.amount },
          notes: { ...(prev.notes || makeField('')), value: row.notes },
        };
      });
      return withSyncedHeaderTotal({ ...current, payments });
    });
  };

  const addDraftItem = (name, option) => {
    const label = String(name || option?.label || '').trim();
    if (!label) return;
    setDraft((current) => {
      if (!current) return current;
      const item = {
        id: `item-${Date.now()}`,
        name: makeField(label),
        qty: makeField('1'),
        unit: makeField(''),
        unitType: 'ea',
        itemType: option?.itemType || '',
        amount: makeField(''),
        imageUrls: [],
        deliveredLabel: '',
      };
      return withSyncedTotalsFromItems({ ...current, items: [...(current.items || []), item] });
    });
  };

  const removeDraftItem = (id) => {
    setDraft((current) => {
      if (!current) return current;
      return withSyncedTotalsFromItems({
        ...current,
        items: (current.items || []).filter((item) => item.id !== id),
      });
    });
  };

  const closeEdit = () => {
    setAddingCustomer(false);
    setPaymentModalOpen(false);
    setOpenKey('');
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
    const next = buildReview(activeRow, draft, { note, errorType, errorAmount, images });
    if (triageReviewEditKey(next) !== baselineKeyRef.current) {
      onSave?.(activeRow.id, next);
    }
    onClose?.();
  };

  if (!mounted || !heldRow) return null;

  const changedCount = corrections.length;
  const header = Array.isArray(draft?.header) ? draft.header : [];
  const items = Array.isArray(draft?.items) ? draft.items : [];
  const payments = Array.isArray(draft?.payments) ? draft.payments : [];
  const customerField = headerField('customer');
  const storeField = headerField('store');
  const employeeField = headerField('employee');
  const dateField = headerField('date');
  const totalField = headerField('total');
  const employeePerson = findStaffByEmployeeName(staffProfiles, employeeField?.value);
  const employeeOptions = (employees || []).map((option) => {
    const person = findStaffByEmployeeName(staffProfiles, option.label);
    return { ...option, avatarUrl: person?.avatarUrl || '' };
  });
  const showPaymentTill = payments.some((payment) => fieldHasText(payment.till));
  const showPaymentNotes = payments.some((payment) => fieldHasText(payment.notes));
  const subtotal = items.reduce((sum, item) => sum + parseMoneyLabel(item?.amount?.value), 0);
  const ticketTotal = parseMoneyLabel(totalField?.value);
  const buyPayments = toBuyPayments(payments);
  const closeMenus = () => setOpenKey('');
  const toggleMenu = (key) => setOpenKey((current) => (current === key ? '' : key));
  const step = TRIAGE_STEPS[stepIndex] || TRIAGE_STEPS[0];
  const nextStep = TRIAGE_STEPS[stepIndex + 1];
  const goToStep = (index) => {
    if (index < 0 || index >= TRIAGE_STEPS.length) return;
    if (index > stepIndex) closeEdit();
    setStepIndex(index);
  };
  const addImageDisabled = images.length >= MAX_REVIEW_IMAGES;

  const stepsNode = (
    <View
      style={[styles.steps, isMobile && styles.stepsMobile]}
      accessibilityRole="progressbar"
      accessibilityLabel={`${step.label}, step ${stepIndex + 1} of ${TRIAGE_STEPS.length}`}
    >
      {TRIAGE_STEPS.map((entry, index) => {
        const active = index === stepIndex;
        const done = index < stepIndex;
        return (
          <View key={entry.id} style={styles.stepItem}>
            {index ? <View style={[styles.stepRule, done && styles.stepRuleDone]} /> : null}
            <Pressable
              onPress={() => {
                if (index <= stepIndex) goToStep(index);
              }}
              style={styles.stepHit}
              accessibilityLabel={entry.label}
              accessibilityState={{ selected: active }}
            >
              <View style={[styles.stepDot, (active || done) && styles.stepDotOn, active && styles.stepDotActive]}>
                <Text style={[styles.stepNum, done && styles.stepNumOn, active && styles.stepNumActive]}>
                  {index + 1}
                </Text>
              </View>
              <Text
                style={[styles.stepLabel, active && styles.stepLabelActive, done && styles.stepLabelDone]}
                numberOfLines={1}
              >
                {entry.label}
              </Text>
            </Pressable>
          </View>
        );
      })}
    </View>
  );
  const nextNode = (
    <Pressable
      onPress={() => {
        if (nextStep) {
          goToStep(stepIndex + 1);
          return;
        }
        finish();
      }}
      disabled={stepIndex === 0 && detailLoading}
      style={[
        styles.nextBtn,
        isMobile && styles.nextBtnMobile,
        stepIndex === 0 && detailLoading && styles.addImageBtnDisabled,
      ]}
      accessibilityLabel={nextStep ? `Next, ${nextStep.label}` : 'Done'}
    >
      <Text style={[styles.nextBtnText, isMobile && styles.nextBtnTextMobile]}>
        {nextStep ? nextStep.label : 'Done'}
      </Text>
      {nextStep ? <Ionicons name="chevron-forward" size={isMobile ? 18 : 16} color="#fff" /> : null}
    </Pressable>
  );
  // Phones: the Details step scrolls as a whole (the ticket bar stacks vertically and
  // the items card grows with its rows), and the keyboard pushes content up on iOS.
  const DetailsPane = isMobile ? ScrollView : View;
  const detailsPaneProps = isMobile
    ? {
        style: styles.stepBody,
        contentContainerStyle: styles.editPaneMobile,
        keyboardShouldPersistTaps: 'handled',
        showsVerticalScrollIndicator: false,
      }
    : { style: styles.editPane };
  const Body = isMobile && Platform.OS === 'ios' ? KeyboardAvoidingView : View;
  const bodyProps = isMobile && Platform.OS === 'ios' ? { behavior: 'padding' } : null;

  return (
    <>
    <TriageDrawer
      visible={visible}
      onClose={onClose}
      flushToSidebar={!isMobile}
      minWidth={720}
      hideNav
    >
      <Body style={[styles.body, isMobile && styles.bodyMobile]} {...bodyProps}>
        <View
          style={[styles.ticketHeader, isMobile && styles.ticketHeaderCompact]}
          {...(Platform.OS === 'web' && isMobile ? { className: 'cgold-mobile-sheet-top' } : null)}
        >
          <View style={styles.headerTitle}>
            <Pressable
              onPress={onClose}
              hitSlop={8}
              style={styles.headerClose}
              accessibilityRole="button"
              accessibilityLabel="Close"
            >
              <Ionicons name="close" size={22} color="#8e8e93" />
            </Pressable>
            <View style={[styles.mark, { backgroundColor: BUY_TINT }]}>
              <Ionicons name="document-text-outline" size={18} color={BUY_ACCENT} />
            </View>
            <Text style={[styles.headerName, isMobile && styles.headerNameMobile]} numberOfLines={1}>
              {heldRow.reference || 'Details'}
            </Text>
          </View>
          {isMobile ? (
            <CapturedPreview
              uri={images[images.length - 1]?.uri}
              count={images.length}
              onPress={() => imagesRef.current?.viewAt?.(images.length - 1)}
            />
          ) : (
            <View style={styles.headerTools}>
              <CapturedPreview
                uri={images[images.length - 1]?.uri}
                count={images.length}
                onPress={() => imagesRef.current?.viewAt?.(images.length - 1)}
              />
              <Pressable
                style={[styles.addImageBtn, addImageDisabled && styles.addImageBtnDisabled]}
                onPress={() => imagesRef.current?.addImage?.()}
                disabled={addImageDisabled}
                accessibilityRole="button"
                accessibilityLabel="Add image"
              >
                <Ionicons name="image-outline" size={18} color="#6e6e73" />
                <Text style={styles.addImageBtnText}>Add image</Text>
                {images.length ? <Text style={styles.addImageCount}>{images.length}</Text> : null}
              </Pressable>
              {stepsNode}
              {nextNode}
            </View>
          )}
        </View>
        {isMobile ? <View style={styles.stepsRowMobile}>{stepsNode}</View> : null}

          {detailLoading && stepIndex === 0 ? (
            <View style={styles.inlineBusy}>
              <ActivityIndicator color={TEXT} />
              <Text style={styles.metaText}>Loading document…</Text>
            </View>
          ) : null}
          {detailError && stepIndex === 0 ? <Text style={styles.warnText}>{detailError}</Text> : null}

          {stepIndex === 0 ? (
            <DetailsPane {...detailsPaneProps}>
              <CapturedPhotoStrip images={images} onChange={setImages} compact={isMobile} />
              <BuyTicketBar
                compact={isMobile}
                subtotal={subtotal}
                total={ticketTotal}
                customer={customerField?.value || ''}
                onCustomerChange={(value, option) => {
                  updateHeader('customer', value);
                  if (option) closeMenus();
                }}
                customerOptions={customerHits}
                customerLoading={customerBusy}
                customerOpen={openKey === 'customer'}
                onCustomerOpen={() => setOpenKey('customer')}
                onAddCustomer={() => {
                  closeMenus();
                  setAddingCustomer(true);
                }}
                orderType={orderType}
                orderTypeOpen={openKey === 'orderType'}
                onToggleOrderType={() => toggleMenu('orderType')}
                onSelectOrderType={(option) => {
                  setOrderType(option.label);
                  closeMenus();
                }}
                status={ticketStatus}
                statusOpen={openKey === 'status'}
                onToggleStatus={() => toggleMenu('status')}
                onSelectStatus={(option) => {
                  setTicketStatus(option.label);
                  closeMenus();
                }}
                payments={buyPayments}
                onOpenPayments={() => {
                  closeMenus();
                  if (!buyPayments.length) {
                    applyBuyPayments([emptyPayment(stripMoney(totalField?.value))]);
                  }
                  setPaymentModalOpen(true);
                }}
                employee={employeeField?.value || ''}
                employeeAvatar={employeePerson?.avatarUrl || ''}
                employeeOpen={openKey === 'employee'}
                onToggleEmployee={() => toggleMenu('employee')}
                employeeOptions={employeeOptions}
                onSelectEmployee={(option) => {
                  updateHeader('employee', option.label);
                  closeMenus();
                }}
                branch={storeField?.value || ''}
                branchOpen={openKey === 'branch'}
                onToggleBranch={() => toggleMenu('branch')}
                branchOptions={locations}
                onSelectBranch={(option) => {
                  updateHeader('store', option.label);
                  closeMenus();
                }}
                occurredAt={occurredAt}
                onDateChange={(next) => {
                  const dated = applyDate(occurredAt, next);
                  setOccurredAt(dated);
                  updateHeader('date', formatPickerDate(dated));
                }}
                onTimeChange={(hours, minutes) => {
                  const timed = applyTime(occurredAt, hours, minutes);
                  setOccurredAt(timed);
                  updateHeader('date', formatPickerDate(timed));
                }}
                onCloseMenus={closeMenus}
              />
              <BuyItemsReviewTable
                compact={isMobile}
                items={items}
                catalogOptions={pricingOptions}
                onUpdateName={(id, value) => updateItem(id, 'name', value)}
                onUpdateQty={(id, value) => updateItem(id, 'qty', value)}
                onUpdateUnit={(id, value) => updateItem(id, 'unit', value)}
                onUpdateAmount={(id, value) => updateItem(id, 'amount', value)}
                onAddItem={addDraftItem}
                onRemoveItem={removeDraftItem}
              />
              {addingCustomer ? (
                <View style={styles.buyCustomerWrap}>
                  <NewCustomerPanel
                    onCancel={() => setAddingCustomer(false)}
                    onCreated={(created) => {
                      updateHeader('customer', created.label);
                      setAddingCustomer(false);
                    }}
                  />
                </View>
              ) : null}
            </DetailsPane>
          ) : null}

          {stepIndex === 1 ? (
            <ScrollView
              style={styles.stepBody}
              contentContainerStyle={[styles.reportContent, isMobile && styles.editContentMobile]}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <ErrorReportFields
                note={note}
                setNote={setNote}
                images={images}
                setImages={setImages}
                isMobile={isMobile}
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
          ) : null}

          {stepIndex === 2 ? (
            <ScrollView
              style={styles.stepBody}
              contentContainerStyle={[styles.reportContent, isMobile && styles.editContentMobile]}
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
              {note || errorType ? (
                <View style={[styles.detailsCard, styles.paneCard, styles.finishNoteCard]}>
                  {errorType ? (
                    <View style={[styles.detailReadRow, !note && styles.detailReadRowLast]}>
                      <Text style={styles.detailReadLabel}>Type of error</Text>
                      <Text style={styles.readValue}>{errorType}</Text>
                    </View>
                  ) : null}
                  {note ? (
                    <View style={[styles.detailReadRow, styles.detailReadRowLast]}>
                      <Text style={styles.detailReadLabel}>Note</Text>
                      <Text style={styles.readValue}>{note}</Text>
                    </View>
                  ) : null}
                </View>
              ) : null}
              <CapturedPhotoStrip
                images={images}
                onChange={setImages}
                readOnly
                compact={isMobile}
                inset={false}
              />
            </ScrollView>
          ) : null}
        {isMobile ? (
          <View style={styles.mobileDock}>
            <Pressable
              style={[styles.mobileDockCamera, addImageDisabled && styles.addImageBtnDisabled]}
              onPress={() => imagesRef.current?.takePhoto?.()}
              disabled={addImageDisabled}
              accessibilityRole="button"
              accessibilityLabel="Take a photo of this PO"
            >
              <Ionicons name="camera" size={22} color={addImageDisabled ? SECONDARY : '#fff'} />
              <Text style={[styles.mobileDockCameraText, addImageDisabled && styles.actionTextDisabled]}>
                Take Photo
              </Text>
              {images.length ? <Text style={styles.mobileDockCount}>{images.length}</Text> : null}
            </Pressable>
            {nextNode}
          </View>
        ) : null}
      </Body>
    </TriageDrawer>
      <TriageCorrectionImages
        ref={imagesRef}
        images={images}
        onChange={setImages}
        pickerOnly
      />
      <PaymentMethodModal
        visible={paymentModalOpen}
        payments={buyPayments}
        total={ticketTotal}
        onChange={applyBuyPayments}
        onClose={() => setPaymentModalOpen(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
    minHeight: 0,
    backgroundColor: '#fff',
  },
  bodyMobile: {
    backgroundColor: MOBILE.bg,
  },
  ticketHeader: {
    width: '88%',
    maxWidth: 980,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    marginTop: 18,
    marginBottom: 32,
  },
  ticketHeaderCompact: {
    gap: 10,
    width: '92%',
    marginTop: 0,
    marginBottom: 10,
    // Web gets the safe-area padding from the cgold-mobile-sheet-top class.
    paddingTop: Platform.OS === 'web' ? 0 : mobileSafeTop(),
  },
  stepsRowMobile: {
    width: '92%',
    alignSelf: 'center',
    marginBottom: 14,
  },
  stepsMobile: {
    justifyContent: 'space-between',
    alignSelf: 'stretch',
  },
  capturedStrip: {
    width: '88%',
    maxWidth: 980,
    alignSelf: 'center',
    marginBottom: 16,
  },
  capturedStripFlush: {
    alignSelf: 'stretch',
    marginTop: 18,
  },
  capturedPreview: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: '#e8e8ed',
    flexShrink: 0,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  capturedPreviewImage: {
    width: 40,
    height: 40,
    borderRadius: 8,
  },
  capturedPreviewBadge: {
    position: 'absolute',
    top: -6,
    right: -6,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    backgroundColor: BUY_ACCENT,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#fff',
  },
  capturedPreviewBadgeText: {
    fontFamily,
    fontSize: 10,
    fontWeight: '700',
    color: '#fff',
  },
  summaryMetaInline: {
    fontFamily,
    fontSize: 12,
    color: SECONDARY,
    marginLeft: 'auto',
  },
  headerTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexShrink: 1,
    minWidth: 0,
  },
  headerClose: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  headerTools: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 12,
    marginLeft: 'auto',
    flexShrink: 1,
    minWidth: 0,
  },
  mark: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerName: {
    fontFamily,
    fontSize: 22,
    fontWeight: '600',
    color: '#1d1d1f',
    letterSpacing: -0.4,
    flexShrink: 1,
  },
  headerNameMobile: {
    fontSize: 18,
  },
  steps: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 1,
    minWidth: 0,
  },
  stepItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  stepHit: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  stepDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: '#d1d1d6',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  stepDotOn: {
    borderColor: BUY_ACCENT,
    backgroundColor: BUY_TINT,
  },
  stepDotActive: {
    backgroundColor: BUY_ACCENT,
  },
  stepNum: {
    fontFamily,
    fontSize: 11,
    fontWeight: '600',
    color: '#8e8e93',
  },
  stepNumOn: {
    color: BUY_ACCENT,
  },
  stepNumActive: {
    color: '#fff',
  },
  stepLabel: {
    fontFamily,
    fontSize: 13,
    fontWeight: '500',
    color: '#8e8e93',
  },
  stepLabelActive: {
    color: '#1d1d1f',
    fontWeight: '600',
  },
  stepLabelDone: {
    color: BUY_ACCENT,
  },
  stepRule: {
    width: 14,
    height: 1,
    backgroundColor: '#d1d1d6',
    marginHorizontal: 8,
  },
  stepRuleDone: {
    backgroundColor: BUY_ACCENT,
  },
  nextBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: 36,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: BUY_ACCENT,
    flexShrink: 0,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  nextBtnMobile: {
    minHeight: 52,
    paddingHorizontal: 18,
    borderRadius: 14,
    flex: 1,
    justifyContent: 'center',
  },
  nextBtnText: {
    fontFamily,
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
  nextBtnTextMobile: {
    fontSize: 17,
  },
  mobileDock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: HAIRLINE,
    backgroundColor: MOBILE.bg,
  },
  mobileDockCamera: {
    flex: 1.15,
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 14,
    backgroundColor: T.blue,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  mobileDockCameraText: {
    fontFamily,
    fontSize: 17,
    fontWeight: '600',
    color: '#fff',
  },
  mobileDockCount: {
    fontFamily,
    fontSize: 13,
    fontWeight: '700',
    color: '#fff',
    backgroundColor: 'rgba(255,255,255,0.22)',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 10,
    overflow: 'hidden',
  },
  actionTextDisabled: {
    color: SECONDARY,
  },
  stepBody: {
    flex: 1,
    minHeight: 0,
  },
  reportContent: {
    width: '88%',
    maxWidth: 980,
    alignSelf: 'center',
    paddingBottom: 40,
  },
  finishNoteCard: {
    marginTop: 18,
  },
  addImageBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 36,
    paddingHorizontal: 8,
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
    fontSize: 13,
    fontWeight: '600',
    color: '#6e6e73',
  },
  addImageCount: {
    fontFamily,
    fontSize: 12,
    fontWeight: '600',
    color: BUY_ACCENT,
  },
  editContent: {
    paddingHorizontal: 0,
    paddingTop: 24,
    paddingBottom: 40,
    backgroundColor: '#fff',
    flexGrow: 1,
  },
  editPane: {
    flex: 1,
    minHeight: 0,
    paddingBottom: 16,
  },
  editPaneMobile: {
    paddingTop: 4,
    paddingBottom: 24,
  },
  editContentMobile: {
    paddingHorizontal: 0,
    paddingTop: 16,
    paddingBottom: 28,
  },
  buyCustomerWrap: {
    width: '88%',
    maxWidth: 980,
    alignSelf: 'center',
    marginTop: 16,
  },
  ticketBar: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 16,
    marginBottom: 22,
    zIndex: 14,
  },
  ticketBarStack: {
    flexDirection: 'column',
    alignItems: 'stretch',
  },
  ticketCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e5ea',
    borderRadius: 12,
    backgroundColor: '#fff',
    overflow: 'visible',
    ...Platform.select({
      web: { boxShadow: '0 8px 24px rgba(0,0,0,0.04)' },
      default: {},
    }),
  },
  ticketCardFlush: {
    width: '100%',
    maxWidth: '100%',
    alignSelf: 'stretch',
  },
  totalsCard: {
    width: 220,
    maxWidth: '100%',
    flexShrink: 0,
    overflow: 'hidden',
  },
  customerCard: {
    flex: 1,
    minWidth: 220,
    zIndex: 16,
  },
  metaCard: {
    flex: 1,
    minWidth: 220,
    zIndex: 15,
  },
  totalsRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 16,
    minHeight: 44,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  totalsRowGrand: {
    alignItems: 'center',
    minHeight: 58,
    paddingVertical: 14,
    backgroundColor: '#EAF6EE',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#d7eadc',
  },
  totalsLabel: {
    fontFamily,
    fontSize: 13,
    fontWeight: '500',
    color: '#6e6e73',
  },
  totalsAmount: {
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: TEXT,
    fontVariant: ['tabular-nums'],
  },
  totalsGrandLabel: {
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: TEXT,
  },
  totalsGrandAmount: {
    fontFamily,
    fontSize: 22,
    fontWeight: '700',
    color: TEXT,
    letterSpacing: -0.4,
    fontVariant: ['tabular-nums'],
  },
  ticketRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 42,
    paddingHorizontal: 14,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ececef',
    zIndex: 1,
    overflow: 'visible',
  },
  ticketRowLast: {
    borderBottomWidth: 0,
  },
  ticketRowRaised: {
    zIndex: 20,
  },
  ticketLabel: {
    fontFamily,
    width: 86,
    flexShrink: 0,
    fontSize: 13,
    fontWeight: '500',
    color: '#6e6e73',
  },
  ticketControl: {
    flex: 1,
    minWidth: 0,
    position: 'relative',
    zIndex: 2,
    alignItems: 'stretch',
  },
  ticketValueRow: {
    justifyContent: 'flex-end',
  },
  ticketInput: {
    fontSize: 15,
    textAlign: 'right',
    paddingVertical: 8,
  },
  ticketMenu: {
    position: 'absolute',
    top: '100%',
    right: 0,
    width: 260,
    marginTop: 6,
    marginHorizontal: 0,
    marginBottom: 0,
    maxHeight: 220,
    zIndex: 40,
  },
  ticketMenuWide: {
    left: 0,
    width: 'auto',
    minWidth: 240,
  },
  lookupOptionPerson: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  lookupOptionCopy: {
    flex: 1,
    minWidth: 0,
  },
  qtyBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 4,
    minHeight: 34,
    paddingHorizontal: 8,
    borderRadius: 8,
    backgroundColor: 'rgba(118, 118, 128, 0.08)',
  },
  qtyBoxInput: {
    fontSize: 15,
    textAlign: 'right',
    paddingVertical: 6,
  },
  qtyBoxSuffix: {
    fontSize: 12,
    color: '#8e8e93',
  },
  itemsToolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    marginTop: 4,
  },
  itemsTitle: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: TEXT,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  colRight: {
    textAlign: 'right',
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
    overflow: 'visible',
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
  compactInputRight: {
    textAlign: 'right',
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
    borderRadius: 12,
    overflow: 'visible',
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
    minHeight: 34,
    paddingHorizontal: 8,
    backgroundColor: '#f6f6f9',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: HAIRLINE,
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
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
    position: 'relative',
    overflow: 'visible',
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
