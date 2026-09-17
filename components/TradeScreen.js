import { createElement, useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import DateTimePicker from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { textMatchesQuery } from '../lib/itemSearch';
import { fetchTransferStores } from '../lib/locations';
import { findStaffByEmployeeName, listStaffProfiles, staffDisplayName } from '../lib/permissions';
import { storeLocationFromSession } from '../lib/profiles';
import { createClient, searchClients } from '../lib/triageLookups';
import { formatAmount, formatDateParam, formatUnitCost, parseDateParam } from '../lib/transactions';
import { BUY_MODAL_TABS, catalogBuyPricelist, catalogItemType, catalogSellMatchKeys, catalogSpecialtyPricelist, fetchWebsitePrices, itemMatchKey, specialtyBuyCatalog } from '../lib/websitePrices';
import { SegmentedSlider, StaffAvatar } from './TriageKit';
import LinePhotoModal from './LinePhotoModal';

const fontFamily = Platform.select({
  ios: 'Sohne',
  android: 'Sohne',
  default: 'Sohne',
});

const BUY = {
  accent: '#1F8A4E',
  tint: '#EAF6EE',
  title: 'Buy',
  subtitle: 'Purchase metal from a customer',
  icon: 'arrow-down-circle',
  hint: 'This is the PMA purchase desk. Customer, items, and payout will live here.',
};

const SELL = {
  accent: '#C0392B',
  tint: '#FCEEEC',
  title: 'Sell',
  subtitle: 'Sell metal to a customer',
  icon: 'arrow-up-circle',
  hint: 'This is the PMA sales desk. Customer, inventory, and payment will live here.',
};

function sessionEmployeeName(session) {
  const profile = session?.profile;
  if (!profile) return '';
  return (
    staffDisplayName(profile) ||
    profile.fullName ||
    [profile.firstName, profile.lastName].filter(Boolean).join(' ').trim()
  );
}

const TICKET_STEPS = [
  { id: 'details', label: 'Details' },
  { id: 'receive', label: 'Receive' },
  { id: 'finish', label: 'Finish' },
];

const ORDER_TYPES = [
  { id: 'standard', label: 'Standard' },
  { id: 'preorder', label: 'Preorder' },
  { id: 'online', label: 'Online Order' },
];

const TICKET_STATUSES = [
  { id: 'open', label: 'Open' },
  { id: 'hold', label: 'On Hold' },
  { id: 'complete', label: 'Completed' },
  { id: 'cancelled', label: 'Cancelled' },
];

const PAYOUT_METHODS = [
  { id: 'cash', label: 'Cash' },
  { id: 'cheque', label: 'Cheque' },
  { id: 'debit', label: 'Debit' },
  { id: 'eft', label: 'EFT' },
  { id: 'etransfer', label: 'e-Transfer' },
  { id: 'store-credit', label: 'Store Credit' },
];

const MONTHS_MMM = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatDateDMY(date) {
  const value = parseDateParam(date);
  const dd = String(value.getDate()).padStart(2, '0');
  return `${dd}-${MONTHS_MMM[value.getMonth()]}-${value.getFullYear()}`;
}

function padTime(date) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function formatTimeLabel(date) {
  return date.toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' });
}

function splitCustomerSeed(value) {
  const text = String(value || '').trim();
  if (!text) return { firstName: '', lastName: '', email: '', phone: '' };
  if (/@/.test(text)) return { firstName: '', lastName: '', email: text, phone: '' };
  if (/^\+?[\d\s().-]{7,}$/.test(text)) return { firstName: '', lastName: '', email: '', phone: '' };
  const parts = text.split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: '', email: '', phone: '' };
  return { firstName: parts[0], lastName: parts.slice(1).join(' '), email: '', phone: '' };
}

function applyDate(current, nextDate) {
  const next = new Date(current);
  const parsed = parseDateParam(nextDate);
  next.setFullYear(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
  return next;
}

function applyTime(current, hours, minutes) {
  const next = new Date(current);
  next.setHours(hours, minutes, 0, 0);
  return next;
}

function uniqueNamed(rows) {
  const seen = new Set();
  const next = [];
  for (const row of rows || []) {
    const label = String(row.label || '').trim();
    const key = label.toLowerCase();
    if (!label || seen.has(key)) continue;
    seen.add(key);
    next.push({ ...row, label });
  }
  return next;
}

let lineSeq = 0;
function nextLineId() {
  lineSeq += 1;
  return `line-${Date.now()}-${lineSeq}`;
}

let paymentSeq = 0;
function nextPaymentId() {
  paymentSeq += 1;
  return `pay-${Date.now()}-${paymentSeq}`;
}

function emptyPayment(amount = '') {
  return { id: nextPaymentId(), method: '', amount, notes: '' };
}

function paymentSummary(payments) {
  const rows = (payments || []).filter((row) => row.method);
  if (!rows.length) return '';
  return rows
    .map((row) => {
      const amount = Number(String(row.amount || '').replace(/,/g, ''));
      if (Number.isFinite(amount) && amount > 0) return `${row.method} ${formatAmount(amount)}`;
      return row.method;
    })
    .join(' · ');
}

function parseQty(value) {
  const n = Number(String(value || '').replace(/,/g, '').trim());
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function lineAmount(line) {
  const qty = parseQty(line.qty);
  const unit = Number(line.unitPrice);
  if (!qty || !Number.isFinite(unit)) return 0;
  return Math.round(qty * unit * 100) / 100;
}

function lineFromCatalog(item, qty = '1') {
  return {
    id: nextLineId(),
    catalogKey: item.key,
    name: item.name,
    group: item.group || '',
    qty,
    unitPrice: item.unitPrice,
    priceLabel: item.priceLabel || '',
    unitType: item.unitType || 'ea',
    itemType: item.itemType || 'Scrap',
  };
}

function rankItemSuggestions(pricelist, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [];
  const scored = [];
  for (const item of pricelist || []) {
    const name = String(item.name || '');
    const hay = String(item.searchText || name);
    if (!textMatchesQuery(hay, q) && !textMatchesQuery(name, q)) continue;
    const lower = name.toLowerCase();
    let score = 4;
    if (lower === q) score = 0;
    else if (lower.startsWith(q)) score = 1;
    else if (lower.includes(q)) score = 2;
    else if (hay.toLowerCase().includes(q)) score = 3;
    scored.push({ item, score, name: lower });
  }
  scored.sort((a, b) => a.score - b.score || a.name.localeCompare(b.name));
  return scored.slice(0, 12).map((row) => row.item);
}

function TicketField({ label, last, raised, compactLabel, children }) {
  return (
    <View style={[styles.fieldRow, last && styles.fieldRowLast, raised && styles.fieldRowRaised]}>
      <Text style={[styles.fieldLabel, compactLabel && styles.fieldLabelCompact]}>{label}</Text>
      <View style={styles.fieldControl}>{children}</View>
    </View>
  );
}

function SuggestField({
  label,
  last,
  value,
  placeholder,
  open,
  onOpen,
  onChange,
  options,
  loading,
  wideMenu,
  compactLabel,
  onAdd,
}) {
  const typed = value.trim().length > 0;
  const showMenu = open && typed;

  return (
    <TicketField label={label} last={last} raised={showMenu} compactLabel={compactLabel}>
      <View style={styles.suggestRow}>
        <TextInput
          style={[styles.fieldInput, styles.suggestInput]}
          value={value}
          onChangeText={(text) => {
            onChange(text);
            onOpen();
          }}
          onFocus={onOpen}
          placeholder={placeholder}
          placeholderTextColor="#c7c7cc"
          autoCorrect={false}
          autoCapitalize="words"
        />
        {onAdd ? (
          <Pressable
            onPress={onAdd}
            hitSlop={6}
            style={styles.customerAddBtn}
            accessibilityLabel="Add customer"
          >
            <Ionicons name="add" size={18} color="#8e8e93" />
          </Pressable>
        ) : null}
      </View>
      {showMenu ? (
        <View style={[styles.menu, wideMenu && styles.menuWide]}>
          {loading ? (
            <Text style={styles.menuEmpty}>Searching…</Text>
          ) : options.length === 0 ? (
            <Text style={styles.menuEmpty}>{value.trim().length < 2 ? 'Keep typing' : 'No matches'}</Text>
          ) : (
            <ScrollView style={styles.menuList} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
              {options.map((option) => (
                <Pressable
                  key={option.id || option.label}
                  style={styles.menuItem}
                  onPress={() => onChange(option.label, option)}
                >
                  <Text style={styles.menuItemLabel} numberOfLines={1}>
                    {option.label}
                  </Text>
                  {option.sub ? (
                    <Text style={styles.menuItemSub} numberOfLines={1}>
                      {option.sub}
                    </Text>
                  ) : null}
                </Pressable>
              ))}
            </ScrollView>
          )}
        </View>
      ) : null}
    </TicketField>
  );
}

function DropdownField({ label, last, value, placeholder, open, onToggle, options, onSelect, compactLabel }) {
  return (
    <TicketField label={label} last={last} raised={open} compactLabel={compactLabel}>
      <Pressable style={styles.dropdownHit} onPress={onToggle}>
        <Text
          style={[styles.fieldValue, !value && styles.fieldPlaceholder]}
          numberOfLines={1}
        >
          {value || placeholder}
        </Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={14} color="#8e8e93" />
      </Pressable>
      {open ? (
        <ScrollView style={styles.menu} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
          {options.length === 0 ? (
            <Text style={styles.menuEmpty}>No branches</Text>
          ) : (
            options.map((option) => (
              <Pressable
                key={option.id || option.label}
                style={styles.menuItem}
                onPress={() => onSelect(option)}
              >
                <Text style={styles.menuItemLabel} numberOfLines={1}>
                  {option.label}
                </Text>
                {option.sub ? (
                  <Text style={styles.menuItemSub} numberOfLines={1}>
                    {option.sub}
                  </Text>
                ) : null}
              </Pressable>
            ))
          )}
        </ScrollView>
      ) : null}
    </TicketField>
  );
}

function EmployeeField({ label, last, name, avatarUrl, open, onToggle, options, onSelect }) {
  return (
    <TicketField label={label} last={last} raised={open}>
      <Pressable style={styles.employeeHit} onPress={onToggle}>
        <Text style={styles.fieldValue} numberOfLines={1}>
          {name || 'Employee'}
        </Text>
        <StaffAvatar uri={avatarUrl || ''} name={name || 'Employee'} size={24} />
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={14} color="#8e8e93" />
      </Pressable>
      {open ? (
        <ScrollView style={styles.menu} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
          {options.map((option) => (
            <Pressable
              key={option.id || option.label}
              style={styles.employeeOption}
              onPress={() => onSelect(option)}
            >
              <StaffAvatar uri={option.avatarUrl || ''} name={option.label} size={22} />
              <View style={styles.employeeOptionCopy}>
                <Text style={styles.menuItemLabel} numberOfLines={1}>
                  {option.label}
                </Text>
                {option.sub ? (
                  <Text style={styles.menuItemSub} numberOfLines={1}>
                    {option.sub}
                  </Text>
                ) : null}
              </View>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}
    </TicketField>
  );
}

function DateField({ value, onChange, onFocus }) {
  const [open, setOpen] = useState(false);
  const dateValue = parseDateParam(value);

  if (Platform.OS === 'web') {
    return (
      <View style={styles.dateHit}>
        <Text style={styles.fieldValue}>{formatDateDMY(dateValue)}</Text>
        {createElement('input', {
          type: 'date',
          value: formatDateParam(dateValue),
          onFocus,
          onChange: (event) => {
            if (event.target.value) onChange(event.target.value);
          },
          style: {
            position: 'absolute',
            left: 0,
            right: 0,
            top: 0,
            bottom: 0,
            opacity: 0,
            width: '100%',
            height: '100%',
            cursor: 'pointer',
            border: 'none',
            background: 'transparent',
          },
        })}
      </View>
    );
  }

  return (
    <>
      <Pressable
        onPress={() => {
          onFocus?.();
          setOpen(true);
        }}
        hitSlop={6}
      >
        <Text style={styles.fieldValue}>{formatDateDMY(dateValue)}</Text>
      </Pressable>
      {Platform.OS === 'android' && open ? (
        <DateTimePicker
          value={value}
          mode="date"
          display="default"
          onChange={(event, selected) => {
            setOpen(false);
            if (event.type !== 'dismissed' && selected) onChange(selected);
          }}
        />
      ) : null}
      {Platform.OS === 'ios' ? (
        <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
          <View style={styles.pickerBackdrop}>
            <Pressable style={StyleSheet.absoluteFill} onPress={() => setOpen(false)} />
            <View style={styles.pickerCard}>
              <View style={styles.pickerHeader}>
                <Text style={styles.pickerTitle}>Date</Text>
                <Pressable onPress={() => setOpen(false)} hitSlop={8}>
                  <Text style={styles.pickerDone}>Done</Text>
                </Pressable>
              </View>
              <DateTimePicker
                value={value}
                mode="date"
                display="spinner"
                onChange={(_, selected) => {
                  if (selected) onChange(selected);
                }}
              />
            </View>
          </View>
        </Modal>
      ) : null}
    </>
  );
}

function TimeField({ value, onChange, onFocus }) {
  const [open, setOpen] = useState(false);

  if (Platform.OS === 'web') {
    return (
      <View style={styles.dateHit}>
        <Text style={styles.fieldValue}>{formatTimeLabel(value)}</Text>
        {createElement('input', {
          type: 'time',
          value: padTime(value),
          onFocus,
          onChange: (event) => {
            const next = String(event.target.value || '').slice(0, 5);
            const match = next.match(/^(\d{1,2}):(\d{2})/);
            if (match) onChange(Number(match[1]), Number(match[2]));
          },
          style: {
            position: 'absolute',
            left: 0,
            right: 0,
            top: 0,
            bottom: 0,
            opacity: 0,
            width: '100%',
            height: '100%',
            cursor: 'pointer',
            border: 'none',
            background: 'transparent',
          },
        })}
      </View>
    );
  }

  return (
    <>
      <Pressable
        onPress={() => {
          onFocus?.();
          setOpen(true);
        }}
        hitSlop={6}
        style={styles.dateHit}
      >
        <Text style={styles.fieldValue}>{formatTimeLabel(value)}</Text>
      </Pressable>
      {Platform.OS === 'android' && open ? (
        <DateTimePicker
          value={value}
          mode="time"
          display="default"
          onChange={(event, selected) => {
            setOpen(false);
            if (event.type !== 'dismissed' && selected) {
              onChange(selected.getHours(), selected.getMinutes());
            }
          }}
        />
      ) : null}
      {Platform.OS === 'ios' ? (
        <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
          <View style={styles.pickerBackdrop}>
            <Pressable style={StyleSheet.absoluteFill} onPress={() => setOpen(false)} />
            <View style={styles.pickerCard}>
              <View style={styles.pickerHeader}>
                <Text style={styles.pickerTitle}>Time</Text>
                <Pressable onPress={() => setOpen(false)} hitSlop={8}>
                  <Text style={styles.pickerDone}>Done</Text>
                </Pressable>
              </View>
              <DateTimePicker
                value={value}
                mode="time"
                display="spinner"
                onChange={(_, selected) => {
                  if (selected) onChange(selected.getHours(), selected.getMinutes());
                }}
              />
            </View>
          </View>
        </Modal>
      ) : null}
    </>
  );
}

function NewCustomerModal({ visible, seed, session, onClose, onCreated }) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!visible) return;
    const next = splitCustomerSeed(seed);
    setFirstName(next.firstName);
    setLastName(next.lastName);
    setEmail(next.email);
    setPhone(next.phone);
    setError('');
    setSaving(false);
  }, [seed, visible]);

  const save = async () => {
    const first = firstName.trim();
    const last = lastName.trim();
    const mail = email.trim();
    if (!first || !last || !mail) {
      setError('First name, last name, and email are required.');
      return;
    }
    if (!session?.token) {
      setError('Sign in to add a customer.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const created = await createClient(
        session.token,
        { firstName: first, lastName: last, email: mail, phone },
        session.baseUrl,
      );
      onCreated(created);
    } catch (err) {
      setError(err?.message || 'Could not add customer.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.catalogBackdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.customerSheet} accessibilityViewIsModal>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>New customer</Text>
            <Pressable onPress={onClose} hitSlop={8} accessibilityLabel="Cancel">
              <Text style={styles.sheetActionMuted}>Cancel</Text>
            </Pressable>
          </View>
          <View style={styles.customerSheetBody}>
            <View style={styles.ticketCard}>
              <TicketField label="First" compactLabel>
                <TextInput
                  style={styles.fieldInput}
                  value={firstName}
                  onChangeText={setFirstName}
                  placeholder="First name"
                  placeholderTextColor="#c7c7cc"
                  autoCapitalize="words"
                  autoCorrect={false}
                />
              </TicketField>
              <TicketField label="Last" compactLabel>
                <TextInput
                  style={styles.fieldInput}
                  value={lastName}
                  onChangeText={setLastName}
                  placeholder="Last name"
                  placeholderTextColor="#c7c7cc"
                  autoCapitalize="words"
                  autoCorrect={false}
                />
              </TicketField>
              <TicketField label="Email" compactLabel>
                <TextInput
                  style={styles.fieldInput}
                  value={email}
                  onChangeText={setEmail}
                  placeholder="name@email.com"
                  placeholderTextColor="#c7c7cc"
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                />
              </TicketField>
              <TicketField label="Phone" last compactLabel>
                <TextInput
                  style={styles.fieldInput}
                  value={phone}
                  onChangeText={setPhone}
                  placeholder="Optional"
                  placeholderTextColor="#c7c7cc"
                  keyboardType="phone-pad"
                />
              </TicketField>
            </View>
            {error ? <Text style={styles.customerSheetError}>{error}</Text> : null}
            <View style={styles.customerSheetActions}>
              <Pressable
                onPress={save}
                disabled={saving}
                hitSlop={8}
                accessibilityLabel="Save customer"
              >
                {saving ? (
                  <ActivityIndicator size="small" color="#1F8A4E" />
                ) : (
                  <Text style={styles.sheetAction}>Add</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function PaymentMethodModal({ visible, payments, total, onChange, onClose }) {
  const [openId, setOpenId] = useState('');

  useEffect(() => {
    if (!visible) setOpenId('');
  }, [visible]);

  const updateRow = (id, patch) => {
    onChange((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  };

  const removeRow = (id) => {
    onChange((current) => current.filter((row) => row.id !== id));
    if (openId === id) setOpenId('');
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.catalogBackdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.paymentSheet} accessibilityViewIsModal>
          <View style={styles.sheetHeader}>
            <View style={styles.catalogHeaderCopy}>
              <Text style={styles.sheetTitle}>Payment</Text>
              <Text style={styles.sheetMeta} numberOfLines={1}>
                Ticket total {formatAmount(total)}
              </Text>
            </View>
            <Pressable onPress={onClose} hitSlop={8} accessibilityLabel="Done">
              <Text style={styles.sheetAction}>Done</Text>
            </Pressable>
          </View>
          <View style={styles.paymentSheetBody}>
            <View style={styles.paymentTable}>
              <View style={styles.paymentHead}>
                <Text style={[styles.paymentHeadLabel, styles.payColMethod]}>Method</Text>
                <Text style={[styles.paymentHeadLabel, styles.payColAmount, styles.colRight]}>Amount</Text>
                <Text style={[styles.paymentHeadLabel, styles.payColNotes]}>Notes</Text>
                <View style={styles.colRemove} />
              </View>
              {payments.length === 0 ? (
                <Text style={styles.paymentEmpty}>Add a payment method for this ticket.</Text>
              ) : (
                payments.map((row, index) => (
                  <View
                    key={row.id}
                    style={[
                      styles.paymentRow,
                      index === payments.length - 1 && styles.paymentRowLast,
                      openId === row.id && styles.paymentRowOpen,
                    ]}
                  >
                    <View style={[styles.payColMethod, styles.paymentMethodCell]}>
                      <Pressable
                        style={styles.paymentMethodHit}
                        onPress={() => setOpenId((current) => (current === row.id ? '' : row.id))}
                      >
                        <Text
                          style={[styles.fieldValue, !row.method && styles.fieldPlaceholder]}
                          numberOfLines={1}
                        >
                          {row.method || 'Select'}
                        </Text>
                        <Ionicons
                          name={openId === row.id ? 'chevron-up' : 'chevron-down'}
                          size={14}
                          color="#8e8e93"
                        />
                      </Pressable>
                      {openId === row.id ? (
                        <View style={styles.paymentMethodMenu}>
                          {PAYOUT_METHODS.map((option) => (
                            <Pressable
                              key={option.id}
                              style={styles.menuItem}
                              onPress={() => {
                                updateRow(row.id, { method: option.label });
                                setOpenId('');
                              }}
                            >
                              <Text style={styles.menuItemLabel}>{option.label}</Text>
                            </Pressable>
                          ))}
                        </View>
                      ) : null}
                    </View>
                    <View style={styles.payColAmount}>
                      <TextInput
                        style={[styles.fieldInput, styles.paymentAmountInput]}
                        value={row.amount}
                        onChangeText={(amount) => updateRow(row.id, { amount })}
                        keyboardType="decimal-pad"
                        placeholder="0.00"
                        placeholderTextColor="#c7c7cc"
                      />
                    </View>
                    <View style={styles.payColNotes}>
                      <TextInput
                        style={styles.fieldInput}
                        value={row.notes}
                        onChangeText={(notes) => updateRow(row.id, { notes })}
                        placeholder="Cheque #, till…"
                        placeholderTextColor="#c7c7cc"
                      />
                    </View>
                    <Pressable
                      onPress={() => removeRow(row.id)}
                      style={styles.colRemove}
                      hitSlop={8}
                      accessibilityLabel="Remove payment"
                    >
                      <Ionicons name="close" size={16} color="#8e8e93" />
                    </Pressable>
                  </View>
                ))
              )}
            </View>
            <View style={styles.paymentSheetActions}>
              <Pressable
                onPress={() => onChange((current) => [...current, emptyPayment()])}
                hitSlop={8}
                accessibilityLabel="Add payment row"
              >
                <Text style={styles.paymentAddLink}>Add payment</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function TicketTotals({ subtotal, total, compact }) {
  return (
    <View style={[styles.ticketCard, styles.totalsCard, compact && styles.totalsCardCompact]}>
      <View style={styles.totalsRow}>
        <Text style={styles.totalsLabel}>Subtotal</Text>
        <Text style={styles.totalsAmount}>{formatAmount(subtotal)}</Text>
      </View>
      <View style={[styles.totalsRow, styles.totalsRowGrand]}>
        <Text style={styles.totalsGrandLabel}>Total</Text>
        <Text style={styles.totalsGrandAmount}>{formatAmount(total)}</Text>
      </View>
    </View>
  );
}

function BuyTicketFields({ session, compact, subtotal = 0, total = 0 }) {
  const [customer, setCustomer] = useState('');
  const [orderType, setOrderType] = useState('Standard');
  const [status, setStatus] = useState('Open');
  const [employee, setEmployee] = useState(() => sessionEmployeeName(session));
  const [branch, setBranch] = useState(() => storeLocationFromSession(session));
  const [occurredAt, setOccurredAt] = useState(() => new Date());
  const [openKey, setOpenKey] = useState('');
  const [staff, setStaff] = useState([]);
  const [stores, setStores] = useState([]);
  const [customerHits, setCustomerHits] = useState([]);
  const [customerBusy, setCustomerBusy] = useState(false);
  const [customerModalOpen, setCustomerModalOpen] = useState(false);
  const [payments, setPayments] = useState([]);
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);

  useEffect(() => {
    const name = sessionEmployeeName(session);
    if (name) setEmployee(name);
    const location = storeLocationFromSession(session);
    if (location) setBranch(location);
  }, [session]);

  useEffect(() => {
    let cancelled = false;
    listStaffProfiles()
      .then((rows) => {
        if (cancelled) return;
        setStaff((rows || []).filter((person) => person.isActive !== false));
      })
      .catch(() => {
        if (!cancelled) setStaff([]);
      });
    if (session) {
      fetchTransferStores(session)
        .then((result) => {
          if (cancelled) return;
          setStores(result?.stores || []);
        })
        .catch(() => {
          if (!cancelled) setStores([]);
        });
    }
    return () => {
      cancelled = true;
    };
  }, [session]);

  const employeePerson = useMemo(() => {
    const match = findStaffByEmployeeName(staff, employee);
    if (match) return match;
    const sessionName = sessionEmployeeName(session);
    if (employee && sessionName && employee === sessionName) return session?.profile || null;
    return null;
  }, [employee, session, staff]);

  const employeeAvatar = employeePerson?.avatarUrl || session?.profile?.avatarUrl || '';

  const employeeOptions = useMemo(() => {
    const rows = uniqueNamed(
      (staff || []).map((person) => ({
        id: person.id,
        label: staffDisplayName(person),
        sub: person.locationName || '',
        avatarUrl: person.avatarUrl || '',
      })),
    );
    if (employee && !rows.some((row) => row.label === employee)) {
      rows.unshift({
        id: 'current',
        label: employee,
        sub: storeLocationFromSession(session),
        avatarUrl: employeeAvatar,
      });
    }
    return rows;
  }, [employee, employeeAvatar, session, staff]);

  const branchOptions = useMemo(() => {
    const rows = uniqueNamed(
      (stores || []).map((store) => ({
        id: store.id,
        label: store.name,
        sub: [store.city, store.state].filter(Boolean).join(', '),
      })),
    );
    if (branch && !rows.some((row) => row.label === branch)) {
      rows.unshift({ id: 'current', label: branch });
    }
    return rows;
  }, [branch, stores]);

  useEffect(() => {
    if (openKey !== 'customer') {
      setCustomerHits([]);
      setCustomerBusy(false);
      return;
    }
    const query = customer.trim();
    if (query.length < 2 || !session?.token) {
      setCustomerHits([]);
      setCustomerBusy(false);
      return;
    }
    let cancelled = false;
    setCustomerBusy(true);
    const timer = setTimeout(() => {
      searchClients(session.token, query, session.baseUrl)
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
  }, [customer, openKey, session]);

  const closeMenus = useCallback(() => setOpenKey(''), []);
  const toggleMenu = (key) => setOpenKey((current) => (current === key ? '' : key));

  return (
    <View style={[styles.ticketBar, compact && styles.ticketBarStack]}>
      <TicketTotals compact={compact} subtotal={subtotal} total={total} />
      <View style={[styles.metaRow, compact && styles.metaRowStack]}>
        <View style={[styles.ticketCard, styles.customerCard, compact && styles.customerCardCompact]}>
        <SuggestField
          label="Customer"
          wideMenu
          compactLabel
          value={customer}
          placeholder="Name or phone"
          open={openKey === 'customer'}
          onOpen={() => setOpenKey('customer')}
          onChange={(value, option) => {
            setCustomer(value);
            if (option) closeMenus();
          }}
          options={customerHits}
          loading={customerBusy}
          onAdd={() => {
            closeMenus();
            setCustomerModalOpen(true);
          }}
        />
        <DropdownField
          label="Order Type"
          compactLabel
          value={orderType}
          placeholder="Standard"
          open={openKey === 'orderType'}
          onToggle={() => toggleMenu('orderType')}
          options={ORDER_TYPES}
          onSelect={(option) => {
            setOrderType(option.label);
            closeMenus();
          }}
        />
        <DropdownField
          label="Status"
          compactLabel
          value={status}
          placeholder="Open"
          open={openKey === 'status'}
          onToggle={() => toggleMenu('status')}
          options={TICKET_STATUSES}
          onSelect={(option) => {
            setStatus(option.label);
            closeMenus();
          }}
        />
        <TicketField label="Payment" last compactLabel>
          <Pressable
            style={styles.dropdownHit}
            onPress={() => {
              closeMenus();
              setPayments((current) =>
                current.length ? current : [emptyPayment(total ? String(total) : '')],
              );
              setPaymentModalOpen(true);
            }}
          >
            <Text
              style={[styles.fieldValue, !paymentSummary(payments) && styles.fieldPlaceholder]}
              numberOfLines={1}
            >
              {paymentSummary(payments) || 'Add payment'}
            </Text>
            <Ionicons name="chevron-forward" size={14} color="#8e8e93" />
          </Pressable>
        </TicketField>
        </View>
        <View style={[styles.ticketCard, styles.metaCard, compact && styles.metaCardCompact]}>
        <EmployeeField
          label="Employee"
          name={employee}
          avatarUrl={employeeAvatar}
          open={openKey === 'employee'}
          onToggle={() => toggleMenu('employee')}
          options={employeeOptions}
          onSelect={(option) => {
            setEmployee(option.label);
            closeMenus();
          }}
        />
        <DropdownField
          label="Branch"
          value={branch}
          placeholder="Select branch"
          open={openKey === 'branch'}
          onToggle={() => toggleMenu('branch')}
          options={branchOptions}
          onSelect={(option) => {
            setBranch(option.label);
            closeMenus();
          }}
        />
        <TicketField label="Date">
          <DateField
            value={occurredAt}
            onFocus={closeMenus}
            onChange={(next) => {
              setOccurredAt((current) => applyDate(current, next));
            }}
          />
        </TicketField>
        <TicketField label="Time" last>
          <TimeField
            value={occurredAt}
            onFocus={closeMenus}
            onChange={(hours, minutes) => {
              setOccurredAt((current) => applyTime(current, hours, minutes));
            }}
          />
        </TicketField>
        </View>
      </View>
      <NewCustomerModal
        visible={customerModalOpen}
        seed={customer}
        session={session}
        onClose={() => setCustomerModalOpen(false)}
        onCreated={(created) => {
          setCustomer(created.label);
          setCustomerModalOpen(false);
          closeMenus();
        }}
      />
      <PaymentMethodModal
        visible={paymentModalOpen}
        payments={payments}
        total={total}
        onChange={setPayments}
        onClose={() => setPaymentModalOpen(false)}
      />
    </View>
  );
}

function QtyField({ value, onChangeText, suffix }) {
  return (
    <View style={styles.qtyWrap}>
      <TextInput
        style={styles.qtyInput}
        value={value}
        onChangeText={onChangeText}
        keyboardType="decimal-pad"
        selectTextOnFocus
        placeholder="0"
        placeholderTextColor="#c7c7cc"
      />
      {suffix ? <Text style={styles.qtySuffix}>{suffix}</Text> : null}
    </View>
  );
}

function itemMatchesBuy(item, section, query) {
  if (!query.trim()) return true;
  return textMatchesQuery(
    [item.name, item.price, section.title, section.group].filter(Boolean).join(' '),
    query,
  );
}

function groupBuySections(sections) {
  const groups = [];
  for (const section of sections) {
    const key = section.group || section.title || '';
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.sections.push(section);
    else groups.push({ key, title: key, sections: [section] });
  }
  return groups;
}

function typeBadgeStyle(itemType) {
  if (itemType === 'Bullion') return styles.typeBullion;
  if (itemType === 'Watch') return styles.typeWatch;
  if (itemType === 'Diamond') return styles.typeDiamond;
  if (itemType === 'Numismatic') return styles.typeNumismatic;
  return styles.typeScrap;
}

function CatalogTabs({ value, onChange }) {
  return (
    <View style={styles.catalogSliderWrap}>
      <SegmentedSlider options={BUY_MODAL_TABS} value={value} onChange={onChange} style={styles.catalogSlider} />
    </View>
  );
}

function CatalogTable({ section, twoCol, onAdd }) {
  const spotSection = /spot/i.test(section.group || '') || /spot/i.test(section.title || '');
  return (
    <View style={[styles.catalogSection, twoCol && styles.catalogGridCell]}>
      <Text style={styles.catalogSectionTitle}>{section.title}</Text>
      <View style={styles.catalogCard}>
        {section.items.map((item, index) => (
          <View
            key={item.name}
            style={[styles.catalogRow, index === section.items.length - 1 && styles.catalogRowLast]}
          >
            <Text style={styles.catalogItemName}>{item.name}</Text>
            <Text style={styles.catalogItemPrice}>{item.price}</Text>
            {spotSection ? null : (
              <Pressable
                onPress={() => onAdd(item, section)}
                style={styles.catalogAdd}
                accessibilityLabel={`Add ${item.name}`}
              >
                <Text style={styles.catalogAddText}>Add</Text>
              </Pressable>
            )}
          </View>
        ))}
      </View>
    </View>
  );
}

function BuyCatalogModal({ visible, catalog, priceByKey, onAdd, onClose }) {
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState('buy');
  const { width } = useWindowDimensions();
  const twoCol = width >= 760;

  useEffect(() => {
    if (visible) {
      setQuery('');
      setTab('buy');
    }
  }, [visible]);

  const spots = tab === 'buy' ? catalog?.buy?.spots || [] : [];
  const sections = useMemo(() => {
    const source =
      tab === 'buy' ? catalog?.buy?.sections || [] : specialtyBuyCatalog(tab)?.sections || [];
    const next = [];
    for (const section of source) {
      const items = (section.items || []).filter((item) => itemMatchesBuy(item, section, query));
      if (!items.length) continue;
      next.push({ ...section, items });
    }
    return next;
  }, [catalog, query, tab]);
  const groups = useMemo(() => groupBuySections(sections), [sections]);

  const addFromCatalog = (item, section) => {
    const hit = priceByKey.get(itemMatchKey(item.name));
    if (hit) {
      onAdd(hit);
    } else {
      const group = section.group || section.title || '';
      const jewellery = /jewellery|jewelry/i.test(group);
      const perGram = jewellery || /\/\s*g\b/i.test(String(item.price || ''));
      const match = String(item.price || '').match(/-?\$?\s*[\d,]+(?:\.\d+)?/);
      const parsed = match ? Number(match[0].replace(/[^0-9.-]/g, '')) : null;
      const destType = section.itemType || catalogItemType(item.name, group, catalogSellMatchKeys(catalog));
      onAdd({
        key: itemMatchKey(item.name),
        name: item.name,
        group,
        unitPrice: Number.isFinite(parsed) ? parsed : null,
        priceLabel: String(item.price || '').trim(),
        unitType: perGram ? 'g' : 'ea',
        itemType: destType,
        searchText: item.name,
      });
    }
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.catalogBackdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.catalogSheet} accessibilityViewIsModal>
          <View style={[styles.sheetHeader, styles.sheetHeaderFlush]}>
            <View style={styles.catalogHeaderCopy}>
              <Text style={styles.sheetTitle}>Add item</Text>
              <Text style={styles.sheetMeta} numberOfLines={1}>
                {tab === 'buy'
                  ? catalog?.updated
                    ? `Updated ${catalog.updated}`
                    : 'Live from canadagold.ca'
                  : 'Quoted in store · CAD'}
                {tab === 'buy' ? ' · CAD' : ''}
              </Text>
            </View>
            <Pressable onPress={onClose} hitSlop={8} accessibilityLabel="Done">
              <Text style={styles.sheetAction}>Done</Text>
            </Pressable>
          </View>

          <CatalogTabs
            value={tab}
            onChange={(next) => {
              setTab(next);
              setQuery('');
            }}
          />

          <View style={styles.catalogSearch}>
            <Ionicons name="search" size={16} color="#8e8e93" />
            <TextInput
              style={styles.catalogSearchInput}
              value={query}
              onChangeText={setQuery}
              placeholder="Search items"
              placeholderTextColor="#8e8e93"
              autoCorrect={false}
              autoCapitalize="none"
              returnKeyType="search"
              accessibilityLabel="Search items"
            />
            {query ? (
              <Pressable onPress={() => setQuery('')} hitSlop={8} accessibilityLabel="Clear">
                <Ionicons name="close-circle" size={16} color="#8e8e93" />
              </Pressable>
            ) : null}
          </View>

          <ScrollView
            style={styles.catalogList}
            contentContainerStyle={styles.catalogListContent}
            keyboardShouldPersistTaps="handled"
          >
            {!query.trim() && spots.length ? (
              <View style={styles.catalogSpots}>
                {spots.map((spot) => (
                  <View key={spot.metal} style={styles.catalogSpot}>
                    <Text style={styles.catalogSpotMetal}>{spot.metal}</Text>
                    <Text style={styles.catalogSpotPrice}>{spot.price}</Text>
                  </View>
                ))}
              </View>
            ) : null}

            {groups.length === 0 ? (
              <Text style={styles.catalogEmpty}>
                {query.trim() ? 'No matching items.' : 'No prices loaded.'}
              </Text>
            ) : (
              groups.map((group) => {
                const grid = twoCol && group.sections.length > 1;
                return (
                  <View key={group.key} style={styles.catalogGroup}>
                    {group.sections.length > 1 ? (
                      <Text style={styles.catalogGroupTitle}>{group.title}</Text>
                    ) : null}
                    <View style={grid ? styles.catalogGrid : styles.catalogStack}>
                      {group.sections.map((section) => (
                        <CatalogTable
                          key={`${section.group}-${section.title}`}
                          section={section}
                          twoCol={grid}
                          onAdd={addFromCatalog}
                        />
                      ))}
                    </View>
                  </View>
                );
              })
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function ItemsTableCard({
  compact,
  expanded,
  busy,
  lines,
  query,
  pickerOpen,
  showMenu,
  suggestions,
  onQueryChange,
  onOpenPicker,
  onClosePicker,
  onSubmitQuery,
  onClearQuery,
  onUpdateQty,
  onRemoveLine,
  onAddTyped,
  onAddItem,
  onOpenCatalog,
  onExpand,
  session,
  onSetLineImage,
}) {
  const [photoLineId, setPhotoLineId] = useState('');
  const photoLine = lines.find((line) => line.id === photoLineId) || null;
  return (
    <View style={[styles.itemsCard, expanded ? styles.itemsCardExpanded : styles.itemsCardInline]}>
      <View style={[styles.itemsHead, compact && styles.itemsHeadCompact]}>
        <Text style={[styles.itemsHeadLabel, styles.colType]}>Type</Text>
        <Text style={[styles.itemsHeadLabel, styles.colItem]}>Item</Text>
        <Text style={[styles.itemsHeadLabel, styles.colQty, styles.colRight]}>Qty</Text>
        <Text style={[styles.itemsHeadLabel, styles.colUnit, styles.colRight]}>Unit price</Text>
        {!compact ? (
          <Text style={[styles.itemsHeadLabel, styles.colAmount, styles.colRight]}>Amount</Text>
        ) : null}
        <View style={styles.colPhoto}>
          <Ionicons name="image-outline" size={14} color="#8e8e93" />
        </View>
        {onExpand ? (
          <Pressable
            onPress={onExpand}
            style={styles.colRemove}
            hitSlop={8}
            accessibilityLabel={expanded ? 'Close items table' : 'Expand items table'}
          >
            <Ionicons name={expanded ? 'close' : 'expand-outline'} size={16} color="#8e8e93" />
          </Pressable>
        ) : (
          <View style={styles.colRemove} />
        )}
      </View>

      {busy ? (
        <View style={styles.itemsEmpty}>
          <ActivityIndicator color="#1F8A4E" />
          <Text style={styles.itemsEmptyText}>Loading website prices…</Text>
        </View>
      ) : (
        <ScrollView
          style={styles.itemsList}
          contentContainerStyle={styles.itemsListContent}
          keyboardShouldPersistTaps="handled"
          nestedScrollEnabled
        >
          {lines.length === 0 ? (
            <Text style={styles.itemsEmptyText}>Add items from the website price list.</Text>
          ) : (
            lines.map((line, index) => {
              const amount = lineAmount(line);
              const missing = line.unitPrice == null;
              return (
                <View
                  key={line.id}
                  style={[styles.itemsRow, index === lines.length - 1 && styles.itemsRowLast]}
                >
                  <View style={styles.colType}>
                    <Text
                      style={[styles.typeBadge, typeBadgeStyle(line.itemType)]}
                      numberOfLines={1}
                    >
                      {line.itemType || 'Scrap'}
                    </Text>
                  </View>
                  <View style={styles.colItem}>
                    <Text style={styles.itemName} numberOfLines={1}>
                      {line.name}
                    </Text>
                    {compact ? (
                      <Text style={[styles.itemAmount, missing && styles.itemMissing]}>
                        {missing ? 'No website price' : formatAmount(amount)}
                      </Text>
                    ) : null}
                  </View>
                  <View style={[styles.colQty, styles.colRight]}>
                    <QtyField
                      value={line.qty}
                      suffix={line.unitType === 'g' ? 'g' : ''}
                      onChangeText={(qty) => onUpdateQty(line.id, qty)}
                    />
                  </View>
                  <View style={[styles.colUnit, styles.colRight]}>
                    <Text style={[styles.itemUnit, missing && styles.itemMissing]} numberOfLines={2}>
                      {missing ? '—' : line.priceLabel || formatUnitCost(line.unitPrice, line.unitType)}
                    </Text>
                  </View>
                  {!compact ? (
                    <View style={[styles.colAmount, styles.colRight]}>
                      <Text style={[styles.itemAmount, missing && styles.itemMissing]}>
                        {missing ? '—' : formatAmount(amount)}
                      </Text>
                    </View>
                  ) : null}
                  <Pressable
                    onPress={() => setPhotoLineId(line.id)}
                    style={styles.colPhoto}
                    hitSlop={8}
                    accessibilityLabel={line.imageUrl ? `View photo for ${line.name}` : `Add photo for ${line.name}`}
                  >
                    {line.imageUrl ? (
                      <Image source={{ uri: line.imageUrl }} style={styles.lineThumb} />
                    ) : (
                      <Ionicons name="image-outline" size={16} color="#8e8e93" />
                    )}
                  </Pressable>
                  <Pressable
                    onPress={() => onRemoveLine(line.id)}
                    style={styles.colRemove}
                    hitSlop={8}
                    accessibilityLabel={`Remove ${line.name}`}
                  >
                    <Ionicons name="close" size={16} color="#8e8e93" />
                  </Pressable>
                </View>
              );
            })
          )}
        </ScrollView>
      )}

      <View nativeID={expanded ? 'buy-add-item-expanded' : 'buy-add-item'} style={styles.addBlock}>
        <View style={styles.addRow}>
          <View style={styles.addField}>
            <Ionicons name="search" size={16} color="#8e8e93" />
            <TextInput
              style={styles.addInput}
              value={query}
              onChangeText={onQueryChange}
              onFocus={onOpenPicker}
              onBlur={() => {
                if (Platform.OS === 'web') return;
                setTimeout(() => onClosePicker?.(), 180);
              }}
              onSubmitEditing={onSubmitQuery}
              placeholder="Add item"
              placeholderTextColor="#c7c7cc"
              autoCorrect={false}
              autoCapitalize="none"
              returnKeyType="done"
              accessibilityLabel="Add item"
            />
            {query ? (
              <Pressable onPress={onClearQuery} hitSlop={8} accessibilityLabel="Clear">
                <Ionicons name="close-circle" size={16} color="#c7c7cc" />
              </Pressable>
            ) : null}
          </View>
          <Pressable
            onPress={onOpenCatalog}
            style={styles.addBtn}
            accessibilityLabel="Add from what we buy"
          >
            <Text style={styles.addBtnText}>Add</Text>
          </Pressable>
        </View>
        {showMenu ? (
          <View style={styles.addMenu}>
            {suggestions.length === 0 ? (
              <View>
                <Text style={styles.menuEmpty}>No matching items</Text>
                {query.trim() ? (
                  <Pressable
                    style={({ hovered, pressed }) => [
                      styles.addMenuItem,
                      (hovered || pressed) && styles.addMenuItemActive,
                    ]}
                    onPress={onAddTyped}
                    accessibilityLabel={`Add ${query.trim()}`}
                  >
                    <View style={styles.addMenuCopy}>
                      <Text style={styles.addMenuLabel} numberOfLines={1}>
                        Add “{query.trim()}”
                      </Text>
                      <Text style={styles.addMenuSub}>Custom item</Text>
                    </View>
                  </Pressable>
                ) : null}
              </View>
            ) : (
              <ScrollView
                style={styles.addMenuList}
                keyboardShouldPersistTaps="handled"
                nestedScrollEnabled
              >
                {suggestions.map((item) => (
                  <Pressable
                    key={item.key}
                    style={({ hovered, pressed }) => [
                      styles.addMenuItem,
                      (hovered || pressed) && styles.addMenuItemActive,
                    ]}
                    onPress={() => onAddItem(item)}
                    accessibilityLabel={`Add ${item.name}`}
                  >
                    <Text
                      style={[styles.typeBadge, styles.addMenuType, typeBadgeStyle(item.itemType)]}
                      numberOfLines={1}
                    >
                      {item.itemType || 'Scrap'}
                    </Text>
                    <View style={styles.addMenuCopy}>
                      <Text style={styles.addMenuLabel} numberOfLines={1}>
                        {item.name}
                      </Text>
                      {item.group ? (
                        <Text style={styles.addMenuSub} numberOfLines={1}>
                          {item.group}
                        </Text>
                      ) : null}
                    </View>
                    <Text style={styles.addMenuPrice} numberOfLines={1}>
                      {item.unitPrice == null
                        ? item.priceLabel || 'Quote'
                        : formatUnitCost(item.unitPrice, item.unitType)}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            )}
          </View>
        ) : null}
      </View>
      <LinePhotoModal
        visible={Boolean(photoLine)}
        line={photoLine}
        session={session}
        onClose={() => setPhotoLineId('')}
        onSave={(imageUrl) => {
          if (photoLine?.id) onSetLineImage?.(photoLine.id, imageUrl);
        }}
      />
    </View>
  );
}

function BuyItemsTable({ compact, session, onTotalsChange }) {
  const [catalog, setCatalog] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [lines, setLines] = useState([]);
  const [query, setQuery] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [tableOpen, setTableOpen] = useState(false);
  const catalogRef = useRef(null);
  catalogRef.current = catalog;

  const pricelist = useMemo(
    () => [...catalogBuyPricelist(catalog), ...catalogSpecialtyPricelist()],
    [catalog],
  );
  const priceByKey = useMemo(() => {
    const map = new Map();
    for (const item of pricelist) map.set(item.key, item);
    return map;
  }, [pricelist]);

  const applyCatalogPrices = useCallback((nextCatalog, currentLines) => {
    const nextList = catalogBuyPricelist(nextCatalog);
    const nextMap = new Map(nextList.map((item) => [item.key, item]));
    return (currentLines || []).map((line) => {
      const hit = nextMap.get(line.catalogKey) || nextMap.get(itemMatchKey(line.name));
      if (!hit) return line;
      return {
        ...line,
        catalogKey: hit.key,
        name: hit.name,
        group: hit.group || line.group,
        unitPrice: hit.unitPrice,
        priceLabel: hit.priceLabel,
        unitType: hit.unitType || line.unitType,
        itemType: hit.itemType || line.itemType || 'Scrap',
      };
    });
  }, []);

  const load = useCallback(
    async ({ force = false, silent = false } = {}) => {
      if (!silent) {
        if (catalogRef.current) setRefreshing(true);
        else setLoading(true);
      }
      try {
        const next = await fetchWebsitePrices({ force });
        setCatalog(next);
        setLines((current) => applyCatalogPrices(next, current));
        setError('');
      } catch (err) {
        setError(err?.message || 'Could not load website prices.');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [applyCatalogPrices],
  );

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!pickerOpen || Platform.OS !== 'web' || typeof document === 'undefined') return undefined;
    const onPointerDown = (event) => {
      const inline = document.getElementById('buy-add-item');
      const expanded = document.getElementById('buy-add-item-expanded');
      if (inline?.contains(event.target) || expanded?.contains(event.target)) return;
      setPickerOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [pickerOpen]);

  const suggestions = useMemo(() => rankItemSuggestions(pricelist, query), [pricelist, query]);

  const addItem = useCallback(
    (item) => {
      if (!item) return;
      setLines((current) => [...current, lineFromCatalog(item, item.unitType === 'g' ? '' : '1')]);
      setQuery('');
      setPickerOpen(false);
    },
    [],
  );

  const addTyped = useCallback(() => {
    const q = query.trim();
    if (!q) return;
    const exact = pricelist.find((item) => item.name.toLowerCase() === q.toLowerCase());
    if (exact) {
      addItem(exact);
      return;
    }
    if (suggestions.length === 1) {
      addItem(suggestions[0]);
      return;
    }
    const key = itemMatchKey(q);
    const hit = priceByKey.get(key);
    if (hit) {
      addItem(hit);
      return;
    }
    setLines((current) => [
      ...current,
      {
        id: nextLineId(),
        catalogKey: key,
        name: q,
        group: '',
        qty: '1',
        unitPrice: null,
        priceLabel: '',
        unitType: 'ea',
        itemType: catalogItemType(q, '', catalogSellMatchKeys(catalog)),
      },
    ]);
    setQuery('');
    setPickerOpen(false);
  }, [addItem, catalog, pricelist, priceByKey, query, suggestions]);

  const updateQty = (id, qty) => {
    setLines((current) => current.map((line) => (line.id === id ? { ...line, qty } : line)));
  };

  const removeLine = (id) => {
    setLines((current) => current.filter((line) => line.id !== id));
  };

  const setLineImage = (id, imageUrl) => {
    setLines((current) => current.map((line) => (line.id === id ? { ...line, imageUrl } : line)));
  };

  const total = useMemo(() => lines.reduce((sum, line) => sum + lineAmount(line), 0), [lines]);
  useEffect(() => {
    onTotalsChange?.({ subtotal: total, total });
  }, [onTotalsChange, total]);
  const busy = loading && !catalog;
  const showMenu = pickerOpen && !busy && query.trim().length > 0;
  const tableProps = {
    busy,
    lines,
    query,
    pickerOpen,
    showMenu,
    suggestions,
    onQueryChange: (value) => {
      setQuery(value);
      setPickerOpen(true);
    },
    onOpenPicker: () => setPickerOpen(true),
    onClosePicker: () => setPickerOpen(false),
    onSubmitQuery: addTyped,
    onClearQuery: () => {
      setQuery('');
      setPickerOpen(false);
    },
    onUpdateQty: updateQty,
    onRemoveLine: removeLine,
    onSetLineImage: setLineImage,
    session,
    onAddTyped: addTyped,
    onAddItem: addItem,
    onOpenCatalog: () => {
      setPickerOpen(false);
      setCatalogOpen(true);
    },
  };

  return (
    <View style={styles.itemsPane}>
      <View style={styles.itemsToolbar}>
        <Text style={styles.itemsTitle}>Items</Text>
        <View style={styles.itemsToolbarSpacer} />
        <Text style={styles.itemsMeta} numberOfLines={1}>
          {error
            ? error
            : catalog?.updated
              ? `Last updated ${catalog.updated}`
              : 'Last updated —'}
          {catalog?.stale ? ' · saved list' : ''}
        </Text>
        <Pressable
          onPress={() => load({ force: true })}
          disabled={loading || refreshing}
          hitSlop={8}
          style={styles.refreshBtn}
          accessibilityLabel="Refresh prices"
        >
          {refreshing || (loading && catalog) ? (
            <ActivityIndicator size="small" color="#1F8A4E" />
          ) : (
            <Ionicons name="refresh" size={16} color="#6e6e73" />
          )}
        </Pressable>
      </View>

      {catalog?.warning && !error ? <Text style={styles.itemsWarning}>{catalog.warning}</Text> : null}

      <ItemsTableCard
        compact={compact}
        expanded={false}
        onExpand={() => {
          setPickerOpen(false);
          setTableOpen(true);
        }}
        {...tableProps}
      />

      <Modal visible={tableOpen} transparent animationType="fade" onRequestClose={() => setTableOpen(false)}>
        <View style={styles.catalogBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setTableOpen(false)} />
          <View style={styles.itemsExpandSheet} accessibilityViewIsModal>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Items</Text>
              <Pressable onPress={() => setTableOpen(false)} hitSlop={8} accessibilityLabel="Done">
                <Text style={styles.sheetAction}>Done</Text>
              </Pressable>
            </View>
            <View style={styles.itemsExpandBody}>
              <ItemsTableCard
                compact={false}
                expanded
                onExpand={() => setTableOpen(false)}
                {...tableProps}
              />
            </View>
          </View>
        </View>
      </Modal>

      <BuyCatalogModal
        visible={catalogOpen}
        catalog={catalog}
        priceByKey={priceByKey}
        onAdd={addItem}
        onClose={() => setCatalogOpen(false)}
      />
    </View>
  );
}

export default function TradeScreen({ mode = 'buy', hideHeader = false, session = null }) {
  const spec = mode === 'sell' ? SELL : BUY;
  const { width } = useWindowDimensions();
  const compact = hideHeader || width < 720;
  const showTicket = mode === 'buy';
  const [ticketTotals, setTicketTotals] = useState({ subtotal: 0, total: 0 });
  const [stepIndex, setStepIndex] = useState(0);

  if (!showTicket) {
    return (
      <View style={styles.screen}>
        {hideHeader ? null : (
          <View style={styles.header}>
            <View style={[styles.mark, { backgroundColor: spec.tint }]}>
              <Ionicons name={spec.icon} size={18} color={spec.accent} />
            </View>
            <Text style={styles.title}>{spec.title}</Text>
          </View>
        )}
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>Ticket coming next</Text>
          <Text style={styles.emptyBody}>{spec.hint}</Text>
        </View>
      </View>
    );
  }

  const step = TICKET_STEPS[stepIndex] || TICKET_STEPS[0];
  const nextStep = TICKET_STEPS[stepIndex + 1];

  return (
    <View style={styles.screen}>
      <View style={[styles.header, compact && styles.headerCompact]}>
        {hideHeader ? null : (
          <View style={styles.headerTitle}>
            <View style={[styles.mark, { backgroundColor: spec.tint }]}>
              <Ionicons name={spec.icon} size={18} color={spec.accent} />
            </View>
            <Text style={styles.title}>{spec.title}</Text>
          </View>
        )}
        <View style={styles.headerTools}>
        <View style={styles.steps} accessibilityRole="progressbar" accessibilityLabel={`${step.label}, step ${stepIndex + 1} of ${TICKET_STEPS.length}`}>
          {TICKET_STEPS.map((entry, index) => {
            const active = index === stepIndex;
            const done = index < stepIndex;
            return (
              <View key={entry.id} style={styles.stepItem}>
                {index ? <View style={[styles.stepRule, done && styles.stepRuleDone]} /> : null}
                <Pressable
                  onPress={() => {
                    if (index <= stepIndex) setStepIndex(index);
                  }}
                  style={styles.stepHit}
                  accessibilityLabel={entry.label}
                  accessibilityState={{ selected: active }}
                >
                  <View style={[styles.stepDot, (active || done) && styles.stepDotOn, active && styles.stepDotActive]}>
                    <Text style={[styles.stepNum, done && styles.stepNumOn, active && styles.stepNumActive]}>{index + 1}</Text>
                  </View>
                  <Text style={[styles.stepLabel, active && styles.stepLabelActive, done && styles.stepLabelDone]} numberOfLines={1}>
                    {entry.label}
                  </Text>
                </Pressable>
              </View>
            );
          })}
        </View>
        {nextStep ? (
          <Pressable
            onPress={() => setStepIndex((current) => Math.min(current + 1, TICKET_STEPS.length - 1))}
            style={styles.nextBtn}
            accessibilityLabel={`Next, ${nextStep.label}`}
          >
            <Text style={styles.nextBtnText}>{nextStep.label}</Text>
            <Ionicons name="chevron-forward" size={16} color="#fff" />
          </Pressable>
        ) : null}
        </View>
      </View>

      <View style={[styles.stepPane, stepIndex !== 0 && styles.stepHidden]}>
        <BuyTicketFields
          session={session}
          compact={compact}
          subtotal={ticketTotals.subtotal}
          total={ticketTotals.total}
        />
        <BuyItemsTable compact={compact} session={session} onTotalsChange={setTicketTotals} />
      </View>
      {stepIndex === 1 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>Receive</Text>
          <Text style={styles.emptyBody}>Receive and payout confirmation will live here.</Text>
        </View>
      ) : null}
      {stepIndex === 2 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>Finish</Text>
          <Text style={styles.emptyBody}>Review and complete the buy ticket here.</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    minHeight: 0,
    backgroundColor: '#fff',
  },
  header: {
    width: '88%',
    maxWidth: 980,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    marginBottom: 32,
  },
  headerCompact: {
    gap: 10,
    width: '88%',
  },
  headerTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexShrink: 0,
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
  title: {
    fontFamily,
    fontSize: 22,
    fontWeight: '600',
    color: '#1d1d1f',
    letterSpacing: -0.4,
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
    borderColor: '#1F8A4E',
    backgroundColor: '#EAF6EE',
  },
  stepDotActive: {
    backgroundColor: '#1F8A4E',
  },
  stepNum: {
    fontFamily,
    fontSize: 11,
    fontWeight: '600',
    color: '#8e8e93',
  },
  stepNumOn: {
    color: '#1F8A4E',
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
    color: '#1F8A4E',
  },
  stepRule: {
    width: 14,
    height: 1,
    backgroundColor: '#d1d1d6',
    marginHorizontal: 8,
  },
  stepRuleDone: {
    backgroundColor: '#1F8A4E',
  },
  nextBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: 36,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: '#1F8A4E',
    flexShrink: 0,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  nextBtnText: {
    fontFamily,
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
  stepPane: {
    flex: 1,
    minHeight: 0,
  },
  stepHidden: {
    display: 'none',
  },
  ticketWrap: {
    width: 320,
    maxWidth: '100%',
    flexShrink: 0,
    alignSelf: 'flex-start',
    zIndex: 12,
  },
  ticketWrapCompact: {
    width: '100%',
    alignSelf: 'stretch',
  },
  ticketBar: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 16,
    marginBottom: 18,
    width: '88%',
    maxWidth: 980,
    alignSelf: 'center',
    zIndex: 14,
  },
  ticketBarStack: {
    flexDirection: 'column',
    alignItems: 'stretch',
  },
  totalsCard: {
    width: 252,
    maxWidth: '100%',
    flexShrink: 0,
    overflow: 'hidden',
  },
  totalsCardCompact: {
    width: '100%',
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
    backgroundColor: BUY.tint,
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
    color: '#1d1d1f',
    letterSpacing: -0.2,
    fontVariant: ['tabular-nums'],
    textAlign: 'right',
  },
  totalsGrandLabel: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: BUY.accent,
  },
  totalsGrandAmount: {
    fontFamily,
    fontSize: 26,
    fontWeight: '600',
    color: '#1d1d1f',
    letterSpacing: -0.6,
    fontVariant: ['tabular-nums'],
    textAlign: 'right',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'flex-end',
    gap: 10,
    flexGrow: 0,
    flexShrink: 1,
    zIndex: 14,
  },
  metaRowStack: {
    flexDirection: 'column',
    alignItems: 'stretch',
  },
  customerCard: {
    width: 300,
    maxWidth: '100%',
    flexGrow: 0,
    flexShrink: 1,
    zIndex: 16,
  },
  customerCardCompact: {
    width: '100%',
    maxWidth: '100%',
    alignSelf: 'stretch',
  },
  metaCard: {
    width: 300,
    maxWidth: '100%',
    flexGrow: 0,
    flexShrink: 1,
    zIndex: 15,
  },
  metaCardCompact: {
    width: '100%',
    maxWidth: '100%',
    alignSelf: 'stretch',
  },
  itemsPane: {
    flexGrow: 0,
    flexShrink: 0,
    minWidth: 0,
    width: '88%',
    maxWidth: 980,
    alignSelf: 'center',
  },
  itemsToolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 10,
  },
  itemsToolbarSpacer: {
    flex: 1,
    minWidth: 8,
  },
  itemsTitle: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: '#1d1d1f',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  itemsMeta: {
    fontFamily,
    fontSize: 12,
    color: '#8e8e93',
    flexShrink: 1,
    textAlign: 'right',
  },
  itemsWarning: {
    fontFamily,
    fontSize: 12,
    color: '#8e8e93',
    marginBottom: 8,
  },
  refreshBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  itemsCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e5ea',
    borderRadius: 12,
    backgroundColor: '#fff',
    overflow: 'visible',
  },
  itemsCardInline: {
    height: 280,
    minHeight: 220,
    maxHeight: 280,
  },
  itemsCardExpanded: {
    flex: 1,
    minHeight: 0,
    height: '100%',
  },
  itemsExpandSheet: {
    width: '94%',
    maxWidth: 1180,
    height: '90%',
    maxHeight: 920,
    borderRadius: 12,
    backgroundColor: '#fff',
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e5ea',
    zIndex: 1,
    ...Platform.select({
      web: { boxShadow: '0 12px 32px rgba(0,0,0,0.10)' },
      default: {},
    }),
  },
  itemsExpandHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 10,
    backgroundColor: '#fff',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e6e6e6',
  },
  itemsExpandBody: {
    flex: 1,
    minHeight: 0,
    padding: 16,
  },
  itemsExpandHeaderTools: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 1,
    minWidth: 0,
  },
  itemsHead: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 34,
    paddingHorizontal: 8,
    backgroundColor: '#f6f6f9',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ececef',
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
  },
  itemsHeadCompact: {
    paddingRight: 4,
  },
  itemsHeadLabel: {
    fontFamily,
    fontSize: 11,
    fontWeight: '600',
    color: '#8e8e93',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
    paddingHorizontal: 8,
  },
  itemsList: {
    flex: 1,
    minHeight: 0,
  },
  itemsListContent: {
    flexGrow: 1,
    paddingBottom: 8,
  },
  itemsEmpty: {
    flex: 1,
    minHeight: 120,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    padding: 24,
  },
  itemsEmptyText: {
    fontFamily,
    fontSize: 14,
    color: '#8e8e93',
    textAlign: 'center',
    paddingHorizontal: 16,
    paddingVertical: 28,
  },
  itemsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ececef',
    gap: 4,
  },
  itemsRowLast: {
    borderBottomWidth: 0,
  },
  colItem: {
    flex: 2.2,
    minWidth: 0,
    paddingHorizontal: 8,
  },
  colType: {
    width: 96,
    flexShrink: 0,
    paddingHorizontal: 6,
  },
  typeBadge: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
  },
  typeBullion: {
    color: '#1F8A4E',
  },
  typeScrap: {
    color: '#C2410C',
  },
  typeWatch: {
    color: '#1D4ED8',
  },
  typeDiamond: {
    color: '#0F766E',
  },
  typeNumismatic: {
    color: '#A67C2D',
  },
  colQty: {
    width: 78,
    flexShrink: 0,
  },
  colUnit: {
    width: 108,
    flexShrink: 0,
  },
  colAmount: {
    width: 104,
    flexShrink: 0,
  },
  colPhoto: {
    width: 32,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  lineThumb: {
    width: 22,
    height: 22,
    borderRadius: 5,
    backgroundColor: '#ececef',
  },
  colRight: {
    alignItems: 'flex-end',
    textAlign: 'right',
  },
  colRemove: {
    width: 32,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  itemName: {
    fontFamily,
    fontSize: 15,
    fontWeight: '500',
    color: '#1d1d1f',
  },
  itemGroup: {
    fontFamily,
    fontSize: 12,
    color: '#8e8e93',
    marginTop: 1,
  },
  itemUnit: {
    fontFamily,
    fontSize: 13,
    color: '#1d1d1f',
    textAlign: 'right',
  },
  itemAmount: {
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: '#1d1d1f',
    textAlign: 'right',
  },
  itemMissing: {
    color: '#8e8e93',
    fontWeight: '400',
  },
  qtyWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 4,
    minHeight: 36,
    paddingHorizontal: 8,
    borderRadius: 8,
    backgroundColor: 'rgba(118, 118, 128, 0.08)',
  },
  qtyInput: {
    fontFamily,
    flex: 1,
    minWidth: 0,
    fontSize: 15,
    color: '#1d1d1f',
    textAlign: 'right',
    paddingVertical: 6,
    ...Platform.select({
      web: { outlineStyle: 'none' },
      default: {},
    }),
  },
  qtySuffix: {
    fontFamily,
    fontSize: 12,
    color: '#8e8e93',
  },
  addBlock: {
    position: 'relative',
    zIndex: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#ececef',
    padding: 10,
  },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  addField: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 40,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: 'rgba(118, 118, 128, 0.08)',
  },
  addInput: {
    flex: 1,
    minWidth: 0,
    fontFamily,
    fontSize: 15,
    color: '#1d1d1f',
    paddingVertical: 8,
    ...Platform.select({
      web: { outlineStyle: 'none' },
      default: {},
    }),
  },
  addBtn: {
    minHeight: 40,
    paddingHorizontal: 16,
    borderRadius: 10,
    backgroundColor: '#1F8A4E',
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  addBtnText: {
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
  },
  addMenu: {
    position: 'absolute',
    left: 10,
    right: 86,
    bottom: 54,
    maxHeight: 280,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e5ea',
    borderRadius: 10,
    backgroundColor: '#fff',
    zIndex: 30,
    overflow: 'hidden',
    ...Platform.select({
      web: { boxShadow: '0 10px 28px rgba(0,0,0,0.12)' },
      default: {},
    }),
  },
  addMenuList: {
    maxHeight: 280,
  },
  addMenuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  addMenuItemActive: {
    backgroundColor: '#f6f6f9',
  },
  addMenuType: {
    width: 78,
    flexShrink: 0,
  },
  addMenuCopy: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  addMenuLabel: {
    fontFamily,
    fontSize: 14,
    fontWeight: '500',
    color: '#1d1d1f',
  },
  addMenuSub: {
    fontFamily,
    fontSize: 12,
    color: '#8e8e93',
  },
  addMenuPrice: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: '#1d1d1f',
    letterSpacing: -0.2,
    fontVariant: ['tabular-nums'],
    flexShrink: 0,
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
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 42,
    paddingHorizontal: 14,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ececef',
    zIndex: 1,
  },
  fieldRowLast: {
    borderBottomWidth: 0,
  },
  fieldRowRaised: {
    zIndex: 20,
  },
  fieldLabel: {
    fontFamily,
    width: 86,
    flexShrink: 0,
    fontSize: 13,
    fontWeight: '500',
    color: '#6e6e73',
  },
  fieldLabelCompact: {
    width: 82,
  },
  fieldControl: {
    flex: 1,
    minWidth: 0,
    position: 'relative',
    zIndex: 2,
    alignItems: 'stretch',
  },
  suggestRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  suggestInput: {
    flex: 1,
    minWidth: 0,
  },
  customerAddBtn: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  customerSheet: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 12,
    backgroundColor: '#fff',
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e5ea',
    zIndex: 1,
    ...Platform.select({
      web: { boxShadow: '0 12px 32px rgba(0,0,0,0.10)' },
      default: {},
    }),
  },
  customerSheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
    backgroundColor: '#fff',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e6e6e6',
  },
  customerSheetBody: {
    padding: 16,
    gap: 12,
  },
  customerSheetError: {
    fontFamily,
    fontSize: 13,
    color: '#C0392B',
  },
  customerSheetActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 16,
  },
  customerSheetCancel: {
    fontFamily,
    fontSize: 15,
    fontWeight: '500',
    color: '#6e6e73',
  },
  customerSheetSave: {
    minHeight: 40,
    minWidth: 72,
    paddingHorizontal: 16,
    borderRadius: 10,
    backgroundColor: '#1F8A4E',
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  customerSheetSaveText: {
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
  },
  paymentSheet: {
    width: '100%',
    maxWidth: 720,
    borderRadius: 12,
    backgroundColor: '#fff',
    overflow: 'visible',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e5ea',
    zIndex: 1,
    ...Platform.select({
      web: { boxShadow: '0 12px 32px rgba(0,0,0,0.10)' },
      default: {},
    }),
  },
  paymentSheetBody: {
    padding: 16,
    gap: 12,
  },
  paymentSheetActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 16,
  },
  paymentAddLink: {
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: '#1F8A4E',
  },
  paymentTable: {
    backgroundColor: '#fff',
    borderRadius: 12,
    overflow: 'visible',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e5ea',
  },
  paymentHead: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 34,
    paddingHorizontal: 8,
    backgroundColor: '#f6f6f9',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ececef',
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
  },
  paymentHeadLabel: {
    fontFamily,
    fontSize: 11,
    fontWeight: '600',
    color: '#8e8e93',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
    paddingHorizontal: 8,
  },
  paymentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 48,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ececef',
    zIndex: 1,
  },
  paymentRowLast: {
    borderBottomWidth: 0,
  },
  paymentRowOpen: {
    zIndex: 20,
  },
  paymentEmpty: {
    fontFamily,
    fontSize: 14,
    color: '#8e8e93',
    textAlign: 'center',
    paddingVertical: 24,
  },
  payColMethod: {
    width: 150,
    flexShrink: 0,
    paddingHorizontal: 6,
    zIndex: 2,
  },
  payColAmount: {
    width: 120,
    flexShrink: 0,
  },
  payColNotes: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: 6,
  },
  paymentMethodCell: {
    position: 'relative',
    overflow: 'visible',
  },
  paymentMethodHit: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 6,
    minHeight: 36,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  paymentMethodMenu: {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    marginTop: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e5ea',
    borderRadius: 10,
    backgroundColor: '#fff',
    zIndex: 40,
    ...Platform.select({
      web: { boxShadow: '0 10px 28px rgba(0,0,0,0.12)' },
      default: {},
    }),
  },
  paymentAmountInput: {
    paddingHorizontal: 8,
  },
  fieldInput: {
    fontFamily,
    fontSize: 15,
    color: '#1d1d1f',
    paddingVertical: 8,
    textAlign: 'right',
    ...Platform.select({
      web: { outlineStyle: 'none' },
      default: {},
    }),
  },
  fieldValue: {
    fontFamily,
    fontSize: 15,
    color: '#1d1d1f',
    textAlign: 'right',
    flexShrink: 1,
    paddingVertical: 8,
  },
  fieldPlaceholder: {
    color: '#c7c7cc',
  },
  dropdownHit: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 6,
    minHeight: 42,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  employeeHit: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
    minHeight: 42,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  employeeOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  employeeOptionCopy: {
    flex: 1,
    minWidth: 0,
  },
  dateHit: {
    position: 'relative',
    minHeight: 42,
    justifyContent: 'center',
    alignItems: 'flex-end',
    width: '100%',
  },
  menu: {
    position: 'absolute',
    top: '100%',
    right: 0,
    width: 260,
    marginTop: 6,
    maxHeight: 220,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e5ea',
    borderRadius: 10,
    backgroundColor: '#fff',
    zIndex: 40,
    ...Platform.select({
      web: { boxShadow: '0 10px 28px rgba(0,0,0,0.12)' },
      default: {},
    }),
  },
  menuWide: {
    left: 0,
    width: 'auto',
    minWidth: 240,
  },
  menuList: {
    maxHeight: 220,
  },
  menuEmpty: {
    fontFamily,
    fontSize: 13,
    color: '#8e8e93',
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  menuItem: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 2,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  menuItemLabel: {
    fontFamily,
    fontSize: 14,
    color: '#1d1d1f',
  },
  menuItemSub: {
    fontFamily,
    fontSize: 12,
    color: '#8e8e93',
  },
  pickerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.28)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  pickerCard: {
    width: 320,
    maxWidth: '100%',
    borderRadius: 16,
    backgroundColor: '#fff',
    overflow: 'hidden',
  },
  pickerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 8,
  },
  pickerTitle: {
    fontFamily,
    fontSize: 16,
    fontWeight: '600',
    color: '#1d1d1f',
  },
  pickerDone: {
    fontFamily,
    fontSize: 16,
    fontWeight: '600',
    color: '#1F8A4E',
  },
  catalogBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  catalogSheet: {
    width: '100%',
    maxWidth: 1040,
    height: '88%',
    maxHeight: 860,
    borderRadius: 12,
    backgroundColor: '#fff',
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e5ea',
    ...Platform.select({
      web: { boxShadow: '0 12px 32px rgba(0,0,0,0.10)' },
      default: {},
    }),
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 12,
    backgroundColor: '#fff',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ececef',
  },
  sheetTitle: {
    fontFamily,
    fontSize: 17,
    fontWeight: '600',
    color: '#1d1d1f',
    letterSpacing: -0.3,
  },
  sheetMeta: {
    fontFamily,
    fontSize: 12,
    color: '#8e8e93',
    marginTop: 2,
  },
  sheetAction: {
    fontFamily,
    fontSize: 16,
    fontWeight: '600',
    color: '#1F8A4E',
  },
  sheetActionMuted: {
    fontFamily,
    fontSize: 16,
    fontWeight: '500',
    color: '#6e6e73',
  },
  sheetHeaderFlush: {
    borderBottomWidth: 0,
    paddingBottom: 4,
  },
  catalogSliderWrap: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 4,
    backgroundColor: '#fff',
  },
  catalogSlider: {
    alignSelf: 'stretch',
    width: '100%',
    minWidth: 0,
    height: 34,
  },
  catalogHeaderCopy: {
    flex: 1,
    minWidth: 0,
  },
  catalogTitle: {
    fontFamily,
    fontSize: 18,
    fontWeight: '600',
    color: '#1d1d1f',
    letterSpacing: -0.3,
  },
  catalogMeta: {
    fontFamily,
    fontSize: 12,
    color: '#8e8e93',
    marginTop: 2,
  },
  catalogSearch: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 8,
    minHeight: 36,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: 'rgba(118, 118, 128, 0.12)',
  },
  catalogSearchInput: {
    flex: 1,
    fontFamily,
    fontSize: 16,
    color: '#1d1d1f',
    paddingVertical: 8,
    ...Platform.select({
      web: { outlineStyle: 'none' },
      default: {},
    }),
  },
  catalogList: {
    flex: 1,
    minHeight: 0,
  },
  catalogListContent: {
    paddingHorizontal: 16,
    paddingBottom: 28,
    gap: 14,
  },
  catalogSpots: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  catalogSpot: {
    minWidth: 120,
    flexGrow: 1,
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e5ea',
  },
  catalogSpotMetal: {
    fontFamily,
    fontSize: 12,
    fontWeight: '600',
    color: '#8e8e93',
    marginBottom: 4,
  },
  catalogSpotPrice: {
    fontFamily,
    fontSize: 18,
    fontWeight: '600',
    color: '#1d1d1f',
    letterSpacing: -0.3,
  },
  catalogSection: {
    gap: 8,
    minWidth: 0,
  },
  catalogGroup: {
    gap: 8,
  },
  catalogGroupTitle: {
    fontFamily,
    fontSize: 16,
    fontWeight: '600',
    color: '#1d1d1f',
    letterSpacing: -0.3,
    paddingHorizontal: 4,
  },
  catalogGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -6,
  },
  catalogGridCell: {
    width: '50%',
    paddingHorizontal: 6,
    marginBottom: 12,
  },
  catalogStack: {
    gap: 14,
  },
  catalogSectionTitle: {
    fontFamily,
    fontSize: 11,
    fontWeight: '600',
    color: '#8e8e93',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
    paddingHorizontal: 8,
  },
  catalogCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e5ea',
  },
  catalogRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 44,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ececef',
  },
  catalogRowLast: {
    borderBottomWidth: 0,
  },
  catalogItemName: {
    flex: 1,
    minWidth: 0,
    fontFamily,
    fontSize: 15,
    fontWeight: '500',
    color: '#1d1d1f',
    letterSpacing: -0.2,
  },
  catalogItemPrice: {
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: '#1d1d1f',
    letterSpacing: -0.2,
    textAlign: 'right',
  },
  catalogAdd: {
    paddingHorizontal: 4,
    paddingVertical: 4,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  catalogAddText: {
    fontFamily,
    fontSize: 14,
    fontWeight: '600',
    color: '#1F8A4E',
  },
  catalogEmpty: {
    fontFamily,
    fontSize: 15,
    color: '#8e8e93',
    textAlign: 'center',
    paddingVertical: 28,
  },
  empty: {
    flex: 1,
    minHeight: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 64,
  },
  emptyTitle: {
    fontFamily,
    fontSize: 18,
    fontWeight: '600',
    color: '#1d1d1f',
    letterSpacing: -0.3,
    marginBottom: 6,
  },
  emptyBody: {
    fontFamily,
    fontSize: 15,
    lineHeight: 21,
    color: '#6e6e73',
    textAlign: 'center',
    maxWidth: 340,
  },
});
