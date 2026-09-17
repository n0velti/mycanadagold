import { createElement, useEffect, useMemo, useRef, useState } from 'react';
import {
  Image,
  KeyboardAvoidingView,
  Linking,
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
import { formatAmount, formatDateParam, parseDateParam } from '../lib/transactions';
import { mobileSafeBottom, useIsMobile } from '../lib/mobileUi';
import { StaffAvatar } from './TriageKit';

const fontFamily = Platform.select({
  ios: 'Sohne',
  android: 'Sohne',
  default: 'Sohne',
});

const BUY = {
  accent: '#1F8A4E',
  tint: '#EAF6EE',
};

export const ORDER_TYPES = [
  { id: 'standard', label: 'Standard' },
  { id: 'preorder', label: 'Preorder' },
  { id: 'online', label: 'Online Order' },
];

export const TICKET_STATUSES = [
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
  const value = parseTicketDate(date);
  const dd = String(value.getDate()).padStart(2, '0');
  return `${dd}-${MONTHS_MMM[value.getMonth()]}-${value.getFullYear()}`;
}

function padTime(date) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function formatTimeLabel(date) {
  return date.toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' });
}

export function parseTicketDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  const raw = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return parseDateParam(raw);
  const parsed = Date.parse(raw);
  if (Number.isFinite(parsed)) return new Date(parsed);
  return new Date();
}

export function applyDate(current, nextDate) {
  const next = new Date(current);
  const parsed = parseTicketDate(nextDate);
  next.setFullYear(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
  return next;
}

export function applyTime(current, hours, minutes) {
  const next = new Date(current);
  next.setHours(hours, minutes, 0, 0);
  return next;
}

let paymentSeq = 0;
function nextPaymentId() {
  paymentSeq += 1;
  return `pay-${Date.now()}-${paymentSeq}`;
}

export function emptyPayment(amount = '') {
  return { id: nextPaymentId(), method: '', amount, notes: '' };
}

export function paymentSummary(payments) {
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

export function normalizePayoutMethod(value) {
  const raw = String(value || '').trim();
  if (!raw || /^payment$/i.test(raw)) return raw;
  const lower = raw.toLowerCase().replace(/[\s_-]+/g, '');
  const hit = PAYOUT_METHODS.find((option) => option.label.toLowerCase().replace(/[\s_-]+/g, '') === lower);
  if (hit) return hit.label;
  if (/cheque|check/.test(lower)) return 'Cheque';
  if (/etransfer|interac/.test(lower)) return 'e-Transfer';
  if (/storecredit|giftcard/.test(lower)) return 'Store Credit';
  if (/debit|visa|mastercard|amex/.test(lower)) return 'Debit';
  if (/eft|wire|ach/.test(lower)) return 'EFT';
  if (/cash/.test(lower)) return 'Cash';
  return raw;
}

export function inferBuyItemType(item) {
  if (item?.itemType) return item.itemType;
  const name = String(item?.name?.value ?? item?.name ?? '');
  const unit = String(item?.unitType || '');
  if (/watch|rolex|omega|patek|tudor|breitling|cartier|hublot/i.test(name)) return 'Watch';
  if (/diamond|gemstone|gia/i.test(name)) return 'Diamond';
  if (/numismatic|paper money|bank note|collector coin/i.test(name)) return 'Numismatic';
  if (/bullion|maple|eagle|krug|wafer|\bbar\b|\boz\b/i.test(name) && unit !== 'g') return 'Bullion';
  return 'Scrap';
}

function useHover() {
  const [hovered, setHovered] = useState(false);
  const hoverProps = useMemo(
    () => ({
      onHoverIn: () => setHovered(true),
      onHoverOut: () => setHovered(false),
    }),
    [],
  );
  return [hovered, hoverProps];
}

// Text input that tints its background on hover and while focused. Clicking anywhere
// in the cell (not just on the text) focuses the input.
function HoverInput({ cellStyle, style, trailing, onFocus, onBlur, ...props }) {
  const inputRef = useRef(null);
  const [hovered, hoverProps] = useHover();
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      {...hoverProps}
      // onPressIn (not onPress) so focusing a field isn't written to the action ledger.
      onPressIn={() => inputRef.current?.focus()}
      focusable={false}
      accessible={false}
      style={[
        styles.editCell,
        hovered && styles.editCellHover,
        focused && styles.editCellFocus,
        cellStyle,
      ]}
    >
      <TextInput
        ref={inputRef}
        {...props}
        style={[styles.editCellInput, style]}
        onFocus={(event) => {
          setFocused(true);
          onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          onBlur?.(event);
        }}
      />
      {trailing || null}
    </Pressable>
  );
}

// Pressable row control (dropdowns, pickers) with the same hover/active tint as inputs.
function HoverHit({ active, style, children, ...props }) {
  const [hovered, hoverProps] = useHover();
  return (
    <Pressable
      {...hoverProps}
      {...props}
      style={[
        styles.editCell,
        styles.editCellBleed,
        hovered && styles.editCellHover,
        active && styles.editCellFocus,
        style,
      ]}
    >
      {children}
    </Pressable>
  );
}

function LineThumb({ urls, label, onPress }) {
  const photos = Array.isArray(urls) ? urls.filter(Boolean) : [];
  const first = photos[0];
  const [hovered, hoverProps] = useHover();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [first]);

  if (!first || failed) {
    return <Ionicons name="image-outline" size={16} color="#8e8e93" />;
  }
  return (
    <Pressable
      {...hoverProps}
      onPress={onPress}
      hitSlop={6}
      style={[styles.lineThumbHit, hovered && styles.lineThumbHitOn]}
      accessibilityRole="imagebutton"
      accessibilityLabel={`View photo of ${label}`}
    >
      <Image source={{ uri: first }} style={styles.lineThumb} onError={() => setFailed(true)} />
    </Pressable>
  );
}

export function ItemPhotoViewer({ visible, photos, label, onClose }) {
  const { width, height } = useWindowDimensions();
  const [index, setIndex] = useState(0);
  const list = useMemo(() => (Array.isArray(photos) ? photos.filter(Boolean) : []), [photos]);

  useEffect(() => {
    if (visible) setIndex(0);
  }, [visible, list]);

  const safeIndex = Math.min(index, Math.max(list.length - 1, 0));
  const current = list[safeIndex] || '';
  const frameWidth = Math.min(width - 48, 960);
  const frameHeight = Math.max(240, Math.min(height * 0.72, 760));
  const step = (delta) => setIndex((i) => (i + delta + list.length) % list.length);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.photoViewerRoot}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close photo" />
        <View style={[styles.photoViewerSheet, { width: frameWidth }]} pointerEvents="box-none">
          <View style={styles.photoViewerBar}>
            <Text style={styles.photoViewerTitle} numberOfLines={1}>
              {label || 'Item'}
            </Text>
            {list.length > 1 ? (
              <Text style={styles.photoViewerCount}>
                {safeIndex + 1} / {list.length}
              </Text>
            ) : null}
            {current ? (
              <Pressable
                onPress={() => Linking.openURL(current).catch(() => {})}
                hitSlop={8}
                style={styles.photoViewerIconBtn}
                accessibilityRole="button"
                accessibilityLabel="Open full-size image"
              >
                <Ionicons name="open-outline" size={20} color="#fff" />
              </Pressable>
            ) : null}
            <Pressable
              onPress={onClose}
              hitSlop={8}
              style={styles.photoViewerIconBtn}
              accessibilityRole="button"
              accessibilityLabel="Close photo"
            >
              <Ionicons name="close" size={22} color="#fff" />
            </Pressable>
          </View>
          <View style={[styles.photoViewerFrame, { height: frameHeight }]}>
            {current ? (
              <Image source={{ uri: current }} style={styles.photoViewerImage} resizeMode="contain" />
            ) : null}
            {list.length > 1 ? (
              <>
                <Pressable
                  style={[styles.photoViewerNav, styles.photoViewerNavLeft]}
                  onPress={() => step(-1)}
                  accessibilityRole="button"
                  accessibilityLabel="Previous photo"
                >
                  <Ionicons name="chevron-back" size={26} color="#fff" />
                </Pressable>
                <Pressable
                  style={[styles.photoViewerNav, styles.photoViewerNavRight]}
                  onPress={() => step(1)}
                  accessibilityRole="button"
                  accessibilityLabel="Next photo"
                >
                  <Ionicons name="chevron-forward" size={26} color="#fff" />
                </Pressable>
              </>
            ) : null}
          </View>
          {list.length > 1 ? (
            <View style={styles.photoViewerStrip}>
              {list.map((uri, i) => (
                <Pressable
                  key={`${uri}-${i}`}
                  onPress={() => setIndex(i)}
                  style={[styles.photoViewerThumb, i === safeIndex && styles.photoViewerThumbOn]}
                  accessibilityRole="button"
                  accessibilityLabel={`Photo ${i + 1}`}
                >
                  <Image source={{ uri }} style={styles.photoViewerThumbImage} />
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>
      </View>
    </Modal>
  );
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
  const typed = String(value || '').trim().length > 0;
  const showMenu = open && typed;

  return (
    <TicketField label={label} last={last} raised={showMenu} compactLabel={compactLabel}>
      <View style={styles.suggestRow}>
        <HoverInput
          cellStyle={[styles.suggestInput, styles.editCellBleedLeft]}
          style={styles.fieldInput}
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
            <Text style={styles.menuEmpty}>
              {String(value || '').trim().length < 2 ? 'Keep typing' : 'No matches'}
            </Text>
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
      <HoverHit style={styles.dropdownHit} onPress={onToggle} active={open} accessibilityRole="button">
        <Text style={[styles.fieldValue, !value && styles.fieldPlaceholder]} numberOfLines={1}>
          {value || placeholder}
        </Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={14} color="#8e8e93" />
      </HoverHit>
      {open ? (
        <ScrollView style={styles.menu} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
          {options.length === 0 ? (
            <Text style={styles.menuEmpty}>No options</Text>
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
      <HoverHit style={styles.employeeHit} onPress={onToggle} active={open} accessibilityRole="button">
        <Text style={styles.fieldValue} numberOfLines={1}>
          {name || 'Employee'}
        </Text>
        <StaffAvatar uri={avatarUrl || ''} name={name || 'Employee'} size={24} />
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={14} color="#8e8e93" />
      </HoverHit>
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
  const dateValue = parseTicketDate(value);

  if (Platform.OS === 'web') {
    return (
      <HoverHit style={styles.dateHit} accessible={false} focusable={false}>
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
      </HoverHit>
    );
  }

  return (
    <>
      <HoverHit
        style={styles.dateHit}
        active={open}
        onPress={() => {
          onFocus?.();
          setOpen(true);
        }}
        hitSlop={6}
        accessibilityRole="button"
      >
        <Text style={styles.fieldValue}>{formatDateDMY(dateValue)}</Text>
      </HoverHit>
      {Platform.OS === 'android' && open ? (
        <DateTimePicker
          value={dateValue}
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
                value={dateValue}
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
  const dateValue = parseTicketDate(value);

  if (Platform.OS === 'web') {
    return (
      <HoverHit style={styles.dateHit} accessible={false} focusable={false}>
        <Text style={styles.fieldValue}>{formatTimeLabel(dateValue)}</Text>
        {createElement('input', {
          type: 'time',
          value: padTime(dateValue),
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
      </HoverHit>
    );
  }

  return (
    <>
      <HoverHit
        style={styles.dateHit}
        active={open}
        onPress={() => {
          onFocus?.();
          setOpen(true);
        }}
        hitSlop={6}
        accessibilityRole="button"
      >
        <Text style={styles.fieldValue}>{formatTimeLabel(dateValue)}</Text>
      </HoverHit>
      {Platform.OS === 'android' && open ? (
        <DateTimePicker
          value={dateValue}
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
                value={dateValue}
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

export function PaymentMethodModal({ visible, payments, total, onChange, onClose }) {
  const [openId, setOpenId] = useState('');
  // Phones: bottom sheet, one payment per stacked card (method + remove, then amount / notes).
  const stacked = useIsMobile();

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
        style={[styles.catalogBackdrop, stacked && styles.sheetBackdropMobile]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={[styles.paymentSheet, stacked && styles.paymentSheetMobile]} accessibilityViewIsModal>
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
              {stacked ? null : (
                <View style={styles.paymentHead}>
                  <Text style={[styles.paymentHeadLabel, styles.payColMethod]}>Method</Text>
                  <Text style={[styles.paymentHeadLabel, styles.payColAmount, styles.colRight]}>Amount</Text>
                  <Text style={[styles.paymentHeadLabel, styles.payColNotes]}>Notes</Text>
                  <View style={styles.colRemove} />
                </View>
              )}
              {payments.length === 0 ? (
                <Text style={styles.paymentEmpty}>Add a payment method for this ticket.</Text>
              ) : (
                payments.map((row, index) => {
                  const methodControl = (
                    <View
                      style={[
                        stacked ? styles.paymentMethodCellStacked : styles.payColMethod,
                        styles.paymentMethodCell,
                      ]}
                    >
                      <HoverHit
                        style={[styles.paymentMethodHit, styles.editCellFlush, stacked && styles.compactCell]}
                        active={openId === row.id}
                        onPress={() => setOpenId((current) => (current === row.id ? '' : row.id))}
                        accessibilityRole="button"
                      >
                        <Text
                          style={[
                            styles.fieldValue,
                            stacked && styles.textLeft,
                            stacked && styles.fieldValueGrow,
                            !row.method && styles.fieldPlaceholder,
                          ]}
                          numberOfLines={1}
                        >
                          {row.method || 'Select method'}
                        </Text>
                        <Ionicons
                          name={openId === row.id ? 'chevron-up' : 'chevron-down'}
                          size={14}
                          color="#8e8e93"
                        />
                      </HoverHit>
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
                  );
                  const amountControl = (
                    <HoverInput
                      cellStyle={stacked && styles.compactCell}
                      style={[styles.fieldInput, stacked && styles.textLeft]}
                      value={row.amount}
                      onChangeText={(amount) => updateRow(row.id, { amount })}
                      keyboardType="decimal-pad"
                      placeholder="0.00"
                      placeholderTextColor="#c7c7cc"
                    />
                  );
                  const notesControl = (
                    <HoverInput
                      cellStyle={stacked && styles.compactCell}
                      style={[styles.fieldInput, stacked && styles.textLeft]}
                      value={row.notes}
                      onChangeText={(notes) => updateRow(row.id, { notes })}
                      placeholder="Cheque #, till…"
                      placeholderTextColor="#c7c7cc"
                    />
                  );
                  const removeControl = (
                    <Pressable
                      onPress={() => removeRow(row.id)}
                      style={styles.colRemove}
                      hitSlop={8}
                      accessibilityLabel="Remove payment"
                    >
                      <Ionicons name="close" size={16} color="#8e8e93" />
                    </Pressable>
                  );
                  const last = index === payments.length - 1;
                  if (stacked) {
                    return (
                      <View
                        key={row.id}
                        style={[
                          styles.paymentRowStacked,
                          last && styles.paymentRowLast,
                          openId === row.id && styles.paymentRowOpen,
                        ]}
                      >
                        <View style={styles.compactTop}>
                          {methodControl}
                          {removeControl}
                        </View>
                        <View style={styles.compactBottom}>
                          <View style={styles.compactField}>
                            <Text style={styles.compactFieldLabel}>Amount</Text>
                            {amountControl}
                          </View>
                          <View style={[styles.compactField, styles.compactFieldWide]}>
                            <Text style={styles.compactFieldLabel}>Notes</Text>
                            {notesControl}
                          </View>
                        </View>
                      </View>
                    );
                  }
                  return (
                    <View
                      key={row.id}
                      style={[styles.paymentRow, last && styles.paymentRowLast, openId === row.id && styles.paymentRowOpen]}
                    >
                      {methodControl}
                      <View style={styles.payColAmount}>{amountControl}</View>
                      <View style={styles.payColNotes}>{notesControl}</View>
                      {removeControl}
                    </View>
                  );
                })
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

function QtyField({ value, onChangeText, suffix, stacked }) {
  return (
    <HoverInput
      cellStyle={[styles.qtyWrap, stacked && styles.compactCell]}
      style={[styles.qtyInput, stacked && styles.textLeft]}
      value={value}
      onChangeText={onChangeText}
      keyboardType="decimal-pad"
      selectTextOnFocus
      placeholder="0"
      placeholderTextColor="#c7c7cc"
      trailing={suffix ? <Text style={styles.qtySuffix}>{suffix}</Text> : null}
    />
  );
}

function typeBadgeStyle(itemType) {
  if (itemType === 'Bullion') return styles.typeBullion;
  if (itemType === 'Watch') return styles.typeWatch;
  if (itemType === 'Diamond') return styles.typeDiamond;
  if (itemType === 'Numismatic') return styles.typeNumismatic;
  return styles.typeScrap;
}

export function BuyTicketBar({
  compact,
  subtotal,
  total,
  customer,
  onCustomerChange,
  customerOptions = [],
  customerLoading,
  customerOpen,
  onCustomerOpen,
  onAddCustomer,
  orderType,
  orderTypeOpen,
  onToggleOrderType,
  onSelectOrderType,
  status,
  statusOpen,
  onToggleStatus,
  onSelectStatus,
  payments,
  onOpenPayments,
  employee,
  employeeAvatar,
  employeeOpen,
  onToggleEmployee,
  employeeOptions = [],
  onSelectEmployee,
  branch,
  branchOpen,
  onToggleBranch,
  branchOptions = [],
  onSelectBranch,
  occurredAt,
  onDateChange,
  onTimeChange,
  onCloseMenus,
}) {
  const summary = paymentSummary(payments);

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
            open={customerOpen}
            onOpen={onCustomerOpen}
            onChange={onCustomerChange}
            options={customerOptions}
            loading={customerLoading}
            onAdd={onAddCustomer}
          />
          <DropdownField
            label="Order Type"
            compactLabel
            value={orderType}
            placeholder="Standard"
            open={orderTypeOpen}
            onToggle={onToggleOrderType}
            options={ORDER_TYPES}
            onSelect={onSelectOrderType}
          />
          <DropdownField
            label="Status"
            compactLabel
            value={status}
            placeholder="Open"
            open={statusOpen}
            onToggle={onToggleStatus}
            options={TICKET_STATUSES}
            onSelect={onSelectStatus}
          />
          <TicketField label="Payment" last compactLabel>
            <HoverHit
              style={styles.dropdownHit}
              onPress={() => {
                onCloseMenus?.();
                onOpenPayments?.();
              }}
              accessibilityRole="button"
            >
              <Text style={[styles.fieldValue, !summary && styles.fieldPlaceholder]} numberOfLines={1}>
                {summary || 'Add payment'}
              </Text>
              <Ionicons name="chevron-forward" size={14} color="#8e8e93" />
            </HoverHit>
          </TicketField>
        </View>
        <View style={[styles.ticketCard, styles.metaCard, compact && styles.metaCardCompact]}>
          <EmployeeField
            label="Employee"
            name={employee}
            avatarUrl={employeeAvatar}
            open={employeeOpen}
            onToggle={onToggleEmployee}
            options={employeeOptions}
            onSelect={onSelectEmployee}
          />
          <DropdownField
            label="Branch"
            value={branch}
            placeholder="Select branch"
            open={branchOpen}
            onToggle={onToggleBranch}
            options={branchOptions}
            onSelect={onSelectBranch}
          />
          <TicketField label="Date">
            <DateField value={occurredAt} onFocus={onCloseMenus} onChange={onDateChange} />
          </TicketField>
          <TicketField label="Time" last>
            <TimeField value={occurredAt} onFocus={onCloseMenus} onChange={onTimeChange} />
          </TicketField>
        </View>
      </View>
    </View>
  );
}

function rankCatalogHits(options, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [];
  const scored = [];
  for (const option of options || []) {
    const name = String(option.label || option.name || '');
    const hay = `${name} ${option.sub || ''} ${option.searchText || ''}`.toLowerCase();
    if (!hay.includes(q)) continue;
    const lower = name.toLowerCase();
    let score = 4;
    if (lower === q) score = 0;
    else if (lower.startsWith(q)) score = 1;
    else if (lower.includes(q)) score = 2;
    scored.push({ option, score, name: lower });
  }
  scored.sort((a, b) => a.score - b.score || a.name.localeCompare(b.name));
  return scored.slice(0, 12).map((row) => row.option);
}

function ItemsReviewCard({
  compact,
  expanded,
  items,
  query,
  pickerOpen,
  suggestions,
  onQueryChange,
  onOpenPicker,
  onClosePicker,
  onAddTyped,
  onAddOption,
  onExpand,
  onUpdateQty,
  onUpdateName,
  onUpdateUnit,
  onUpdateAmount,
  onRemoveItem,
  onViewPhoto,
}) {
  const showMenu = pickerOpen && String(query || '').trim().length > 0;
  // Phones: rows stack (name on top, qty / unit / amount underneath) and the card
  // grows with its content so the surrounding screen scrolls instead of the card.
  const Rows = compact ? View : ScrollView;
  const rowsProps = compact
    ? { style: styles.itemsListCompact }
    : {
        style: styles.itemsList,
        contentContainerStyle: styles.itemsListContent,
        keyboardShouldPersistTaps: 'handled',
        nestedScrollEnabled: true,
      };
  return (
    <View
      style={[
        styles.itemsCard,
        expanded ? styles.itemsCardExpanded : compact ? styles.itemsCardCompact : styles.itemsCardInline,
      ]}
    >
      {compact ? null : (
        <View style={styles.itemsHead}>
          <Text style={[styles.itemsHeadLabel, styles.colType]}>Type</Text>
          <Text style={[styles.itemsHeadLabel, styles.colItem]}>Item</Text>
          <Text style={[styles.itemsHeadLabel, styles.colQty, styles.colRight]}>Qty</Text>
          <Text style={[styles.itemsHeadLabel, styles.colUnit, styles.colRight]}>Unit price</Text>
          <Text style={[styles.itemsHeadLabel, styles.colAmount, styles.colRight]}>Amount</Text>
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
      )}
      <Rows {...rowsProps}>
        {items.length === 0 ? (
          <Text style={styles.itemsEmptyText}>No line items</Text>
        ) : compact ? (
          items.map((item, index) => {
            const itemType = inferBuyItemType(item);
            const itemLabel = item.name?.value || 'Item';
            return (
              <View
                key={item.id}
                style={[styles.itemsRowCompact, index === items.length - 1 && styles.itemsRowLast]}
              >
                <View style={styles.compactTop}>
                  <Text style={[styles.typeBadge, styles.typeBadgeCompact, typeBadgeStyle(itemType)]} numberOfLines={1}>
                    {itemType}
                  </Text>
                  <HoverInput
                    cellStyle={[styles.itemCell, styles.compactNameCell]}
                    style={styles.itemName}
                    value={String(item.name?.value ?? '')}
                    onChangeText={(value) => onUpdateName?.(item.id, value)}
                    placeholder="Item"
                    placeholderTextColor="#c7c7cc"
                  />
                  <View style={styles.colPhoto}>
                    <LineThumb urls={item.imageUrls} label={itemLabel} onPress={() => onViewPhoto?.(item)} />
                  </View>
                  {onRemoveItem ? (
                    <Pressable
                      onPress={() => onRemoveItem(item.id)}
                      style={styles.colRemove}
                      hitSlop={8}
                      accessibilityLabel={`Remove ${itemLabel}`}
                    >
                      <Ionicons name="close" size={16} color="#8e8e93" />
                    </Pressable>
                  ) : null}
                </View>
                <View style={styles.compactBottom}>
                  <View style={styles.compactField}>
                    <Text style={styles.compactFieldLabel}>
                      {item.unitType === 'g' ? 'Qty (g)' : 'Qty'}
                    </Text>
                    <QtyField
                      stacked
                      value={String(item.qty?.value ?? '')}
                      onChangeText={(qty) => onUpdateQty?.(item.id, qty)}
                    />
                  </View>
                  <View style={styles.compactField}>
                    <Text style={styles.compactFieldLabel}>Unit price</Text>
                    <HoverInput
                      cellStyle={styles.compactCell}
                      style={[styles.itemUnit, styles.textLeft]}
                      value={String(item.unit?.value ?? '')}
                      onChangeText={(value) => onUpdateUnit?.(item.id, value)}
                      placeholder="—"
                      placeholderTextColor="#c7c7cc"
                      keyboardType="decimal-pad"
                    />
                  </View>
                  <View style={styles.compactField}>
                    <Text style={styles.compactFieldLabel}>Amount</Text>
                    <HoverInput
                      cellStyle={styles.compactCell}
                      style={[styles.itemAmount, styles.textLeft]}
                      value={String(item.amount?.value ?? '')}
                      onChangeText={(value) => onUpdateAmount?.(item.id, value)}
                      placeholder="—"
                      placeholderTextColor="#c7c7cc"
                      keyboardType="decimal-pad"
                    />
                  </View>
                </View>
              </View>
            );
          })
        ) : (
          items.map((item, index) => {
            const itemType = inferBuyItemType(item);
            const itemLabel = item.name?.value || 'Item';
            return (
              <View
                key={item.id}
                style={[styles.itemsRow, index === items.length - 1 && styles.itemsRowLast]}
              >
                <View style={styles.colType}>
                  <Text style={[styles.typeBadge, typeBadgeStyle(itemType)]} numberOfLines={1}>
                    {itemType}
                  </Text>
                </View>
                <View style={styles.colItem}>
                  <HoverInput
                    cellStyle={[styles.itemCell, styles.editCellBleed]}
                    style={styles.itemName}
                    value={String(item.name?.value ?? '')}
                    onChangeText={(value) => onUpdateName?.(item.id, value)}
                    placeholder="Item"
                    placeholderTextColor="#c7c7cc"
                  />
                </View>
                <View style={[styles.colQty, styles.colRight]}>
                  <QtyField
                    value={String(item.qty?.value ?? '')}
                    suffix={item.unitType === 'g' ? 'g' : ''}
                    onChangeText={(qty) => onUpdateQty?.(item.id, qty)}
                  />
                </View>
                <View style={[styles.colUnit, styles.colRight]}>
                  <HoverInput
                    cellStyle={styles.itemCell}
                    style={styles.itemUnit}
                    value={String(item.unit?.value ?? '')}
                    onChangeText={(value) => onUpdateUnit?.(item.id, value)}
                    placeholder="—"
                    placeholderTextColor="#c7c7cc"
                  />
                </View>
                <View style={[styles.colAmount, styles.colRight]}>
                  <HoverInput
                    cellStyle={styles.itemCell}
                    style={styles.itemAmount}
                    value={String(item.amount?.value ?? '')}
                    onChangeText={(value) => onUpdateAmount?.(item.id, value)}
                    placeholder="—"
                    placeholderTextColor="#c7c7cc"
                  />
                </View>
                <View style={styles.colPhoto}>
                  <LineThumb
                    urls={item.imageUrls}
                    label={itemLabel}
                    onPress={() => onViewPhoto?.(item)}
                  />
                </View>
                {onRemoveItem ? (
                  <Pressable
                    onPress={() => onRemoveItem(item.id)}
                    style={styles.colRemove}
                    hitSlop={8}
                    accessibilityLabel={`Remove ${item.name?.value || 'item'}`}
                  >
                    <Ionicons name="close" size={16} color="#8e8e93" />
                  </Pressable>
                ) : (
                  <View style={styles.colRemove} />
                )}
              </View>
            );
          })
        )}
      </Rows>
      <View style={styles.addBlock}>
        <View style={styles.addRow}>
          <View style={styles.addField}>
            <Ionicons name="search" size={16} color="#8e8e93" />
            <TextInput
              style={styles.addInput}
              value={query}
              onChangeText={onQueryChange}
              onFocus={onOpenPicker}
              onSubmitEditing={onAddTyped}
              placeholder="Add item"
              placeholderTextColor="#c7c7cc"
              autoCorrect={false}
              autoCapitalize="none"
              returnKeyType="done"
              accessibilityLabel="Add item"
            />
            {query ? (
              <Pressable onPress={() => onQueryChange('')} hitSlop={8} accessibilityLabel="Clear">
                <Ionicons name="close-circle" size={16} color="#c7c7cc" />
              </Pressable>
            ) : null}
          </View>
          <Pressable onPress={onAddTyped} style={styles.addBtn} accessibilityLabel="Add item">
            <Text style={styles.addBtnText}>Add</Text>
          </Pressable>
        </View>
        {showMenu ? (
          <View style={styles.addMenu}>
            {suggestions.length === 0 ? (
              <Pressable style={styles.addMenuItem} onPress={onAddTyped}>
                <View style={styles.addMenuCopy}>
                  <Text style={styles.addMenuLabel} numberOfLines={1}>
                    Add “{String(query || '').trim()}”
                  </Text>
                  <Text style={styles.addMenuSub}>Custom item</Text>
                </View>
              </Pressable>
            ) : (
              <ScrollView style={styles.addMenuList} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
                {suggestions.map((option) => (
                  <Pressable
                    key={option.id || option.label}
                    style={styles.addMenuItem}
                    onPress={() => onAddOption(option)}
                  >
                    <View style={styles.addMenuCopy}>
                      <Text style={styles.addMenuLabel} numberOfLines={1}>
                        {option.label}
                      </Text>
                      {option.sub ? (
                        <Text style={styles.addMenuSub} numberOfLines={1}>
                          {option.sub}
                        </Text>
                      ) : null}
                    </View>
                  </Pressable>
                ))}
              </ScrollView>
            )}
          </View>
        ) : null}
      </View>
    </View>
  );
}

export function BuyItemsReviewTable({
  compact,
  items,
  catalogOptions = [],
  onUpdateQty,
  onUpdateName,
  onUpdateUnit,
  onUpdateAmount,
  onAddItem,
  onRemoveItem,
}) {
  const [query, setQuery] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [tableOpen, setTableOpen] = useState(false);
  const [viewer, setViewer] = useState(null);
  const suggestions = rankCatalogHits(catalogOptions, query);

  const addTyped = () => {
    const name = String(query || '').trim();
    const hit = suggestions[0];
    if (hit) {
      onAddItem?.(hit.label, hit);
    } else if (name) {
      onAddItem?.(name);
    }
    setQuery('');
    setPickerOpen(false);
  };

  const tableProps = {
    items,
    query,
    pickerOpen,
    suggestions,
    onQueryChange: (value) => {
      setQuery(value);
      setPickerOpen(true);
    },
    onOpenPicker: () => setPickerOpen(true),
    onClosePicker: () => setPickerOpen(false),
    onAddTyped: addTyped,
    onAddOption: (option) => {
      onAddItem?.(option.label, option);
      setQuery('');
      setPickerOpen(false);
    },
    onUpdateQty,
    onUpdateName,
    onUpdateUnit,
    onUpdateAmount,
    onRemoveItem,
    onViewPhoto: (item) => {
      const photos = (item?.imageUrls || []).filter(Boolean);
      if (!photos.length) return;
      setPickerOpen(false);
      setViewer({ photos, label: item?.name?.value || 'Item' });
    },
  };

  return (
    <View style={styles.itemsPane}>
      <View style={styles.itemsToolbar}>
        <Text style={styles.itemsTitle}>Items</Text>
        <View style={styles.itemsToolbarSpacer} />
        <Text style={styles.itemsMeta} numberOfLines={1}>
          {items.length} {items.length === 1 ? 'item' : 'items'}
        </Text>
      </View>
      <ItemsReviewCard
        compact={compact}
        expanded={false}
        onExpand={
          compact
            ? null
            : () => {
                setPickerOpen(false);
                setTableOpen(true);
              }
        }
        {...tableProps}
      />
      <Modal
        visible={tableOpen && !compact}
        transparent
        animationType="fade"
        onRequestClose={() => setTableOpen(false)}
      >
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
              <ItemsReviewCard
                compact={false}
                expanded
                onExpand={() => setTableOpen(false)}
                {...tableProps}
              />
            </View>
          </View>
        </View>
      </Modal>
      <ItemPhotoViewer
        visible={Boolean(viewer)}
        photos={viewer?.photos || []}
        label={viewer?.label || ''}
        onClose={() => setViewer(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
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
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  editCell: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'stretch',
    minWidth: 0,
    gap: 4,
    paddingHorizontal: 8,
    borderRadius: 8,
    backgroundColor: 'transparent',
    ...Platform.select({
      web: { cursor: 'text', transitionProperty: 'background-color', transitionDuration: '120ms' },
      default: {},
    }),
  },
  editCellHover: {
    backgroundColor: 'rgba(118, 118, 128, 0.10)',
  },
  editCellFocus: {
    backgroundColor: BUY.tint,
    ...Platform.select({
      web: { boxShadow: `inset 0 0 0 1px ${BUY.accent}` },
      default: {},
    }),
  },
  editCellInput: {
    flex: 1,
    minWidth: 0,
  },
  editCellBleed: {
    marginHorizontal: -8,
  },
  editCellBleedLeft: {
    marginLeft: -8,
  },
  editCellFlush: {
    marginHorizontal: 0,
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
  catalogHeaderCopy: {
    flex: 1,
    minWidth: 0,
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
  sheetBackdropMobile: {
    justifyContent: 'flex-end',
    padding: 0,
  },
  paymentSheetMobile: {
    maxWidth: '100%',
    borderRadius: 16,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    paddingBottom: mobileSafeBottom(),
  },
  paymentRowStacked: {
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 10,
    gap: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ececef',
    zIndex: 1,
  },
  paymentMethodCellStacked: {
    flex: 1,
    minWidth: 0,
    zIndex: 2,
  },
  fieldValueGrow: {
    flex: 1,
  },
  compactFieldWide: {
    flex: 1.5,
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
  itemsMeta: {
    fontFamily,
    fontSize: 12,
    color: '#8e8e93',
    flexShrink: 1,
    textAlign: 'right',
  },
  itemsTitle: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: '#1d1d1f',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
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
  itemsCardCompact: {
    minHeight: 120,
  },
  itemsListCompact: {
    flexGrow: 0,
  },
  itemsRowCompact: {
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 10,
    gap: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ececef',
  },
  compactTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  compactNameCell: {
    flex: 1,
    minHeight: 40,
  },
  typeBadgeCompact: {
    fontSize: 11,
    letterSpacing: 0.2,
    textTransform: 'uppercase',
    width: 64,
    flexShrink: 0,
  },
  compactBottom: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
  },
  compactField: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  compactCell: {
    minHeight: 40,
    justifyContent: 'flex-start',
  },
  textLeft: {
    textAlign: 'left',
  },
  compactFieldLabel: {
    fontFamily,
    fontSize: 10,
    fontWeight: '600',
    color: '#8e8e93',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
    paddingLeft: 8,
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
  itemsExpandBody: {
    flex: 1,
    minHeight: 0,
    padding: 16,
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
  },
  lineThumbHit: {
    width: 24,
    height: 24,
    borderRadius: 6,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      web: { cursor: 'zoom-in', transitionProperty: 'transform', transitionDuration: '120ms' },
      default: {},
    }),
  },
  lineThumbHitOn: {
    transform: [{ scale: 1.25 }],
    ...Platform.select({
      web: { boxShadow: `0 0 0 2px ${BUY.accent}` },
      default: {},
    }),
  },
  lineThumb: {
    width: 24,
    height: 24,
    backgroundColor: '#ececef',
  },
  itemCell: {
    minHeight: 32,
  },
  photoViewerRoot: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.78)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  photoViewerSheet: {
    maxWidth: '100%',
    gap: 12,
  },
  photoViewerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  photoViewerTitle: {
    flex: 1,
    minWidth: 0,
    fontFamily,
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  photoViewerCount: {
    fontFamily,
    fontSize: 13,
    color: 'rgba(255,255,255,0.72)',
    fontVariant: ['tabular-nums'],
  },
  photoViewerIconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  photoViewerFrame: {
    width: '100%',
    borderRadius: 12,
    backgroundColor: '#111',
    overflow: 'hidden',
    justifyContent: 'center',
  },
  photoViewerImage: {
    width: '100%',
    height: '100%',
  },
  photoViewerNav: {
    position: 'absolute',
    top: '50%',
    marginTop: -22,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  photoViewerNavLeft: {
    left: 12,
  },
  photoViewerNavRight: {
    right: 12,
  },
  photoViewerStrip: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'center',
  },
  photoViewerThumb: {
    width: 56,
    height: 56,
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: 'transparent',
    opacity: 0.7,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  photoViewerThumbOn: {
    borderColor: '#fff',
    opacity: 1,
  },
  photoViewerThumbImage: {
    width: '100%',
    height: '100%',
    backgroundColor: '#222',
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
  },
  itemName: {
    fontFamily,
    fontSize: 15,
    fontWeight: '500',
    color: '#1d1d1f',
    paddingVertical: 0,
    ...Platform.select({
      web: { outlineStyle: 'none' },
      default: {},
    }),
  },
  itemUnit: {
    fontFamily,
    fontSize: 13,
    color: '#1d1d1f',
    textAlign: 'right',
    paddingVertical: 0,
    ...Platform.select({
      web: { outlineStyle: 'none' },
      default: {},
    }),
  },
  itemAmount: {
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: '#1d1d1f',
    textAlign: 'right',
    paddingVertical: 0,
    ...Platform.select({
      web: { outlineStyle: 'none' },
      default: {},
    }),
  },
  qtyWrap: {
    justifyContent: 'flex-end',
    minHeight: 32,
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
});
