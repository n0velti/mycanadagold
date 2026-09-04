import { createElement, Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import DateTimePicker from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { useAppAccess } from '../lib/permissions';
import {
  countedPhysicalTotal,
  fetchBullionAudit,
  fetchBullionAuditStores,
  formatQty,
  formatWeekColumnLabel,
  saveInventoryLog,
} from '../lib/bullionAudit';
import { saveNightCount } from '../lib/bullionNight';
import {
  analyzeBullionDiscrepancy,
  buildUnbalancedBullionItems,
  continueBullionAuditChat,
} from '../lib/bullionAuditAi';
import { analyzeCashDiscrepancy, continueCashAuditChat } from '../lib/cashAudit';
import {
  AUDIT_CASH_STORES,
  fetchStoreCashPosition,
  formatAmount,
  QUEBEC_STORES,
} from '../lib/cashTill';
import {
  formatDateParam,
  formatPickerDate,
  parseDateParam,
} from '../lib/transactions';
import {
  formatModelReleased,
  getModelMeta,
  OPENROUTER_MODELS,
} from '../lib/openrouter';
import { AuditAiChat, AuditTxnDrawer, useAuditTxnDrawer } from './AuditAiOutput';

const fontFamily = Platform.select({
  ios: 'Sohne',
  android: 'Sohne',
  default: 'Sohne',
});

const ACCENT = '#2F8A4E';
const TEXT = '#1d1d1f';
const SECONDARY = '#8e8e93';
const FILL = '#e8e8ed';
const GROUP_BG = '#f2f2f7';
const HAIRLINE = '#e5e5ea';
const CHEVRON = '#c7c7cc';
const MOBILE_BREAKPOINT = 768;
const AUDIT_TABS = [
  { key: 'bullion', label: 'Bullion' },
  { key: 'cash', label: 'Cash' },
];
const METAL_ACCENTS = {
  Gold: '#D4A017',
  Silver: '#7A8494',
  Platinum: '#2F6FED',
  Palladium: '#8B3A9C',
};

function metalAccent(name) {
  const raw = String(name || '');
  const hit = Object.keys(METAL_ACCENTS).find((metal) =>
    raw.toLowerCase().includes(metal.toLowerCase()),
  );
  return METAL_ACCENTS[hit] || '#8e8e93';
}

function useIsMobile() {
  const { width } = useWindowDimensions();
  return width < MOBILE_BREAKPOINT;
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
  disabled = false,
  style,
  showLabel = false,
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((opt) => opt.value === value);

  return (
    <>
      <Pressable
        style={[styles.filterSelect, disabled && styles.filterSelectDisabled, style]}
        onPress={() => {
          if (!disabled) setOpen(true);
        }}
        disabled={disabled}
      >
        <View style={styles.filterSelectCopy}>
          {showLabel && label ? <Text style={styles.filterSelectLabel}>{label}</Text> : null}
          <Text style={styles.filterSelectValue} numberOfLines={1}>
            {selected?.label || label || 'Select'}
          </Text>
        </View>
        <Ionicons name="chevron-down" size={14} color={SECONDARY} />
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View style={styles.filterModalRoot}>
          <Pressable style={styles.filterModalBackdrop} onPress={() => setOpen(false)} />
          <View style={styles.filterModalSheet}>
            <View style={styles.filterModalHeader}>
              <Text style={styles.filterModalTitle}>{label || 'Select'}</Text>
              <Pressable onPress={() => setOpen(false)} hitSlop={8}>
                <Text style={styles.dateModalDone}>Done</Text>
              </Pressable>
            </View>
            <ScrollView style={styles.filterModalList} keyboardShouldPersistTaps="handled">
              {options.map((option) => {
                const active = option.value === value;
                return (
                  <Pressable
                    key={option.value}
                    style={[styles.filterModalOption, active && styles.filterModalOptionActive]}
                    onPress={() => {
                      onChange(option.value);
                      setOpen(false);
                    }}
                  >
                    <Text
                      style={[
                        styles.filterModalOptionText,
                        active && styles.filterModalOptionTextActive,
                      ]}
                      numberOfLines={1}
                    >
                      {option.label}
                    </Text>
                    {active ? <Ionicons name="checkmark" size={16} color={ACCENT} /> : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}

function SegmentedControl({ options, value, onChange, style, stretch = false }) {
  return (
    <View style={[styles.segment, stretch && styles.segmentStretch, style]} accessibilityRole="tablist">
      {options.map((option) => {
        const active = option.key === value;
        return (
          <Pressable
            key={option.key}
            style={[
              styles.segmentButton,
              stretch && styles.segmentButtonStretch,
              active && styles.segmentButtonActive,
            ]}
            onPress={() => onChange(option.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
          >
            <Text style={[styles.segmentText, active && styles.segmentTextActive]} numberOfLines={1}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function FilterBar({ children, style }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      style={[styles.filterBar, style]}
      contentContainerStyle={styles.filterBarContent}
    >
      {children}
    </ScrollView>
  );
}

function GroupSection({ title, children, style }) {
  return (
    <View style={[styles.groupSection, style]}>
      {title ? <Text style={styles.groupSectionTitle}>{title}</Text> : null}
      <View style={styles.group}>{children}</View>
    </View>
  );
}

const MODEL_OPTIONS = OPENROUTER_MODELS;
const DEFAULT_MODEL =
  MODEL_OPTIONS.find((model) => model.key === 'anthropic/claude-sonnet-5')?.key ||
  MODEL_OPTIONS[0].key;

function parseQtyInput(value) {
  const cleaned = String(value || '')
    .replace(/[^0-9.-]/g, '')
    .trim();
  if (!cleaned || cleaned === '-' || cleaned === '.' || cleaned === '-.') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function qtyInputText(value) {
  if (value == null || value === '') return '';
  return formatQty(value);
}

function emptyQtyDraft() {
  return { vault: '', night: '', store: '', other: '' };
}

function countedTotalFromDraft(draft) {
  return countedPhysicalTotal(parseQtyInput(draft?.vault), parseQtyInput(draft?.night));
}

const QTY_FIELDS = ['vault', 'night', 'store', 'other'];
const QTY_HEADER_LABELS = { vault: 'Vault', night: 'Night', store: 'Store', other: 'Other' };
const BULLION_TABLE_BASE_WIDTH = 692;
const BULLION_HIST_COL_WIDTH = 48;

function formatHistoryWeekday(dateKey) {
  return parseDateParam(dateKey).toLocaleDateString('en-CA', { weekday: 'narrow' });
}

function draftShowsDiff(draft, confirmed) {
  return (
    Boolean(confirmed) ||
    QTY_FIELDS.some((field) => String(draft?.[field] || '') !== '')
  );
}

function DateChip({ label, value, onChange, maximumDate }) {
  const [open, setOpen] = useState(false);
  const dateValue = parseDateParam(value);

  const commit = (next) => {
    if (!next) return;
    let date = parseDateParam(next);
    if (maximumDate && date > parseDateParam(maximumDate)) {
      date = parseDateParam(maximumDate);
    }
    onChange(date);
  };

  const field = (
    <>
      <Ionicons name="calendar-outline" size={16} color={SECONDARY} />
      {Platform.OS === 'web'
        ? createElement('input', {
            type: 'date',
            value: formatDateParam(dateValue),
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
              minWidth: 118,
              letterSpacing: -0.2,
            },
          })
        : <Text style={styles.appleDateValue}>{formatPickerDate(dateValue)}</Text>}
    </>
  );

  if (Platform.OS === 'web') {
    return <View style={styles.appleDateField}>{field}</View>;
  }

  return (
    <>
      <Pressable style={styles.appleDateField} onPress={() => setOpen(true)}>
        {field}
      </Pressable>

      {Platform.OS === 'android' && open ? (
        <DateTimePicker
          value={dateValue}
          mode="date"
          display="default"
          maximumDate={maximumDate ? parseDateParam(maximumDate) : undefined}
          onChange={(event, selected) => {
            setOpen(false);
            if (event.type !== 'dismissed' && selected) commit(selected);
          }}
        />
      ) : null}

      {Platform.OS === 'ios' ? (
        <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
          <View style={styles.dateModalBackdrop}>
            <Pressable style={StyleSheet.absoluteFill} onPress={() => setOpen(false)} />
            <View style={styles.dateModalCard}>
              <View style={styles.dateModalHeader}>
                <Text style={styles.dateModalTitle}>{label || 'Date'}</Text>
                <Pressable onPress={() => setOpen(false)} hitSlop={8}>
                  <Text style={styles.dateModalDone}>Done</Text>
                </Pressable>
              </View>
              <DateTimePicker
                value={dateValue}
                mode="date"
                display="spinner"
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

function parseMoneyInput(value) {
  const cleaned = String(value || '')
    .replace(/[^0-9.-]/g, '')
    .trim();
  if (!cleaned || cleaned === '-' || cleaned === '.' || cleaned === '-.') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** Cash-count denominations: bills (50 notes/stack) and coin rolls with fixed stack values. */
const CASH_DENOMS = [
  { key: 'd100', label: '100', face: 100, stackBills: 50 },
  { key: 'd50', label: '50', face: 50, stackBills: 50 },
  { key: 'd20', label: '20', face: 20, stackBills: 50 },
  { key: 'd10', label: '10', face: 10, stackBills: 50 },
  { key: 'd5', label: '5', face: 5, stackBills: 50 },
  { key: 'd2', label: '$2', face: 2, stackValue: 50 },
  { key: 'd1', label: '$1', face: 1, stackValue: 25 },
  { key: 'd025', label: '$0.25', face: 0.25, stackValue: 10 },
];

const USD_DENOMS = [
  { key: 'd100', label: '100', face: 100, stackBills: 50 },
  { key: 'd50', label: '50', face: 50, stackBills: 50 },
  { key: 'd20', label: '20', face: 20, stackBills: 50 },
  { key: 'd10', label: '10', face: 10, stackBills: 50 },
  { key: 'd5', label: '5', face: 5, stackBills: 50 },
  { key: 'd1', label: '1', face: 1, stackBills: 50 },
];

const CASH_DRAWERS = [
  { key: 'cad', label: 'Till 1 CAD', currency: 'CAD' },
  { key: 'usd', label: 'USD', currency: 'USD' },
];

const EMPTY_CASH_TOTALS = {
  count: 0,
  cashIn: 0,
  cashOut: 0,
  net: 0,
  inCount: 0,
  outCount: 0,
};

function emptyDenomCounts(denoms = CASH_DENOMS) {
  return Object.fromEntries(denoms.map((d) => [d.key, '']));
}

function denomLooseValue(denom, countText) {
  const n = parseQtyInput(countText);
  if (n == null) return 0;
  return n * denom.face;
}

function denomStackValue(denom, countText) {
  const n = parseQtyInput(countText);
  if (n == null) return 0;
  if (denom.stackValue != null) return n * denom.stackValue;
  return n * denom.stackBills * denom.face;
}

function computeCountedFromDenoms(denoms, looseCounts, stackCounts, otherText) {
  const otherCash = parseMoneyInput(otherText);
  const hasDenomCount =
    Boolean(String(otherText || '').trim()) ||
    denoms.some(
      (d) =>
        String(looseCounts[d.key] || '').trim() !== '' ||
        String(stackCounts[d.key] || '').trim() !== '',
    );
  const columns = denoms.map((denom) => {
    const loose = denomLooseValue(denom, looseCounts[denom.key]);
    const stacks = denomStackValue(denom, stackCounts[denom.key]);
    return {
      key: denom.key,
      loose,
      stacks,
      total: loose + stacks,
    };
  });
  const otherTotal = otherCash != null ? otherCash : 0;
  const total = hasDenomCount
    ? Math.round(
        (columns.reduce((sum, col) => sum + col.total, 0) + otherTotal) * 100,
      ) / 100
    : null;
  return { hasDenomCount, columns, otherTotal, total };
}

function denomTitle(denom) {
  if (denom.face >= 1 && Number.isInteger(denom.face)) return `$${denom.face}`;
  return `$${denom.face}`;
}

function denomHint(denom) {
  if (denom.stackValue != null) return `$${denom.stackValue}/roll`;
  return `${denom.stackBills} bills`;
}

function splitCashDenoms(denoms) {
  return {
    bills: denoms.filter((d) => d.stackBills != null),
    coins: denoms.filter((d) => d.stackValue != null),
  };
}

function modelOptionMetaLine(option) {
  const parts = [];
  if (option.provider) parts.push(option.provider);
  parts.push(`Speed: ${option.speed}`);
  parts.push(`Accuracy: ${option.accuracy}`);
  if (option.released) parts.push(`Released ${formatModelReleased(option.released)}`);
  return parts.join('  ·  ');
}

function DiffBadge({ total, systemCount, confirmed, compact = false }) {
  if (!confirmed) {
    return <Text style={[styles.diffMuted, compact && styles.diffMutedCompact]}>—</Text>;
  }
  const diff = (Number(total) || 0) - (Number(systemCount) || 0);
  const rounded = Math.round(diff * 1000) / 1000;
  const balanced = Math.abs(rounded) < 0.0005;
  return (
    <View
      style={[
        styles.diffBadge,
        compact && styles.diffBadgeCompact,
        balanced ? styles.diffBadgeOk : rounded < 0 ? styles.diffBadgeShort : styles.diffBadgeOver,
      ]}
    >
      <Text
        style={[
          styles.diffBadgeText,
          compact && styles.diffBadgeTextCompact,
          balanced
            ? styles.diffBadgeTextOk
            : rounded < 0
              ? styles.diffBadgeTextShort
              : styles.diffBadgeTextOver,
        ]}
      >
        {balanced ? '0' : `${rounded > 0 ? '+' : ''}${formatQty(rounded)}`}
      </Text>
    </View>
  );
}

function metalGroupLabel(row) {
  const metal = String(row?.metal || '').trim();
  return metal || 'Other';
}

function BullionQtyInput({
  value,
  onChangeText,
  onSubmitEditing,
  onBlur,
  inputRef,
  label,
  dense,
  large,
}) {
  return (
    <TextInput
      ref={inputRef}
      value={value}
      onChangeText={onChangeText}
      keyboardType="decimal-pad"
      inputMode="decimal"
      placeholder="—"
      placeholderTextColor={CHEVRON}
      selectTextOnFocus
      autoCorrect={false}
      autoCapitalize="none"
      blurOnSubmit={false}
      returnKeyType="next"
      onSubmitEditing={onSubmitEditing}
      onBlur={onBlur}
      accessibilityLabel={label}
      style={[styles.bInput, dense && !large && styles.bInputDense, large && styles.bInputLarge]}
      onFocus={(event) => {
        const node = event?.target;
        if (node && typeof node.select === 'function') {
          requestAnimationFrame(() => node.select());
        }
      }}
    />
  );
}

function BullionTableRow({
  row,
  draft,
  historyDates,
  dense,
  striped,
  isSaving,
  savingAll,
  showDiff,
  onChangeField,
  onBlurField,
  onUpdate,
  registerQtyInput,
  onSubmitField,
}) {
  const total = countedTotalFromDraft(draft);
  const accent = metalAccent(row.metal);
  const mismatch =
    showDiff && Math.abs(total - (Number(row.systemCount) || 0)) >= 0.0005;

  return (
    <View
      style={[
        styles.bullionRow,
        striped && styles.bullionRowStriped,
        mismatch && styles.bullionRowOff,
      ]}
    >
      <View style={[styles.bAccent, { backgroundColor: accent }]} />
      <View style={[styles.bColItem, styles.bItemCell]}>
        <Text style={styles.bItemName} numberOfLines={1}>
          {row.name}
        </Text>
        {row.sku ? (
          <Text style={styles.bItemSku} numberOfLines={1}>
            {row.sku}
          </Text>
        ) : null}
      </View>
      {historyDates.map((day) => {
        const value = row.history?.[day];
        return (
          <Text key={day} style={[styles.bullionCell, styles.bColHist, styles.bHistCell]}>
            {value == null ? '—' : formatQty(value)}
          </Text>
        );
      })}
      <Text style={[styles.bullionCell, styles.bColNum, styles.bSystemCell]}>
        {formatQty(row.systemCount)}
      </Text>
      {QTY_FIELDS.map((field) => (
        <View key={field} style={styles.bColInput}>
          <BullionQtyInput
            value={draft[field]}
            onChangeText={(value) => onChangeField(field, value)}
            onSubmitEditing={() => onSubmitField(field)}
            onBlur={field === 'night' ? () => onBlurField?.(field) : undefined}
            inputRef={registerQtyInput(field)}
            label={field}
            dense={dense}
          />
        </View>
      ))}
      <Text style={[styles.bullionCell, styles.bColNum, styles.bTotalCell]}>
        {formatQty(total)}
      </Text>
      <View style={styles.bColDiff}>
        <DiffBadge
          total={total}
          systemCount={row.systemCount}
          confirmed={showDiff}
          compact
        />
      </View>
      <View style={styles.bColAction}>
        <Pressable
          style={[styles.bUpdateButton, (isSaving || savingAll) && styles.rowActionDisabled]}
          onPress={onUpdate}
          disabled={isSaving || savingAll}
          accessibilityLabel="Update"
        >
          {isSaving ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Ionicons name="checkmark" size={16} color="#fff" />
          )}
        </Pressable>
      </View>
    </View>
  );
}

function BullionMobileCard({
  row,
  draft,
  historyDates,
  isSaving,
  savingAll,
  showDiff,
  onChangeField,
  onBlurField,
  onUpdate,
  registerQtyInput,
  onSubmitField,
}) {
  const total = countedTotalFromDraft(draft);
  const accent = metalAccent(row.metal);
  const mismatch =
    showDiff && Math.abs(total - (Number(row.systemCount) || 0)) >= 0.0005;

  return (
    <View style={[styles.bMobileCard, mismatch && styles.bMobileCardOff]}>
      <View style={[styles.bMobileAccent, { backgroundColor: accent }]} />
      <View style={styles.bMobileInner}>
        <View style={styles.bMobileHead}>
          <View style={styles.bMobileTitleWrap}>
            <Text style={styles.bMobileName}>{row.name}</Text>
            {row.sku ? (
              <Text style={styles.bMobileSku} numberOfLines={1}>
                {row.sku}
              </Text>
            ) : null}
          </View>
          <DiffBadge total={total} systemCount={row.systemCount} confirmed={showDiff} />
          <Pressable
            style={[styles.bMobileUpdate, (isSaving || savingAll) && styles.rowActionDisabled]}
            onPress={onUpdate}
            disabled={isSaving || savingAll}
            accessibilityLabel="Update"
          >
            {isSaving ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Ionicons name="checkmark" size={18} color="#fff" />
            )}
          </Pressable>
        </View>

        <View style={styles.bMobileStats}>
          <View style={styles.bMobileStat}>
            <Text style={styles.bMobileStatLabel}>System</Text>
            <Text style={styles.bMobileStatValue}>{formatQty(row.systemCount)}</Text>
          </View>
          <View style={styles.bMobileStatDivider} />
          <View style={styles.bMobileStat}>
            <Text style={styles.bMobileStatLabel}>Physical</Text>
            <Text style={styles.bMobileStatValue}>{formatQty(total)}</Text>
          </View>
        </View>

        {historyDates.length ? (
          <View style={styles.bMobileHistory}>
            {historyDates.map((day) => {
              const value = row.history?.[day];
              return (
                <View key={day} style={styles.bMobileHistCell}>
                  <Text style={styles.bMobileHistLabel}>{formatHistoryWeekday(day)}</Text>
                  <Text style={styles.bMobileHistValue} numberOfLines={1}>
                    {value == null ? '—' : formatQty(value)}
                  </Text>
                </View>
              );
            })}
          </View>
        ) : null}

        <View style={styles.bMobileFields}>
          {QTY_FIELDS.map((field) => (
            <View key={field} style={styles.bMobileField}>
              <Text style={styles.bMobileFieldLabel}>{QTY_HEADER_LABELS[field]}</Text>
              <BullionQtyInput
                value={draft[field]}
                onChangeText={(value) => onChangeField(field, value)}
                onSubmitEditing={() => onSubmitField(field)}
                onBlur={field === 'night' ? () => onBlurField?.(field) : undefined}
                inputRef={registerQtyInput(field)}
                label={QTY_HEADER_LABELS[field]}
                large
              />
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

function CashTxnRow({ row, last = false, fallbackLabel = '—' }) {
  const inbound = row.type === 'In';
  return (
    <View style={[styles.cashTxnRow, last && styles.statRowLast]}>
      <Text style={[styles.cashTxnKind, inbound ? styles.cashIn : styles.cashOut]}>
        {inbound ? 'In' : 'Out'}
      </Text>
      <View style={styles.cashTxnMain}>
        <Text style={styles.cashTxnName} numberOfLines={1}>
          {row.customerName || row.category || fallbackLabel}
        </Text>
        {row.reference || row.comments ? (
          <Text style={styles.cashTxnMeta} numberOfLines={1}>
            {[row.reference, row.comments].filter(Boolean).join(' · ')}
          </Text>
        ) : null}
      </View>
      <Text style={[styles.cashTxnAmount, inbound ? styles.cashIn : styles.cashOut]} numberOfLines={1}>
        {row.amountLabel}
      </Text>
    </View>
  );
}

function CashCountInput({
  value,
  onChangeText,
  onSubmitEditing,
  inputRef,
  label,
  money = false,
  style,
}) {
  return (
    <TextInput
      ref={inputRef}
      value={value}
      onChangeText={onChangeText}
      keyboardType={money ? 'decimal-pad' : 'number-pad'}
      inputMode={money ? 'decimal' : 'numeric'}
      placeholder={money ? '0.00' : '0'}
      placeholderTextColor={CHEVRON}
      selectTextOnFocus
      autoCorrect={false}
      autoCapitalize="none"
      blurOnSubmit={false}
      returnKeyType="next"
      onSubmitEditing={onSubmitEditing}
      accessibilityLabel={label}
      style={[styles.cashCountInput, style]}
      onFocus={(event) => {
        const node = event?.target;
        if (node && typeof node.select === 'function') {
          requestAnimationFrame(() => node.select());
        }
      }}
    />
  );
}

function CashFold({ title, detail, amount, amountStyle, open, onToggle, empty, children }) {
  return (
    <View style={styles.group}>
      <Pressable
        style={[styles.cashFoldHeader, open && !empty && styles.cashFoldHeaderOpen]}
        onPress={empty ? undefined : onToggle}
        disabled={empty}
      >
        <View style={styles.cashFoldCopy}>
          <Text style={styles.cashFoldTitle}>{title}</Text>
          <Text style={styles.cashFoldDetail} numberOfLines={1}>
            {detail}
          </Text>
        </View>
        <Text style={[styles.cashFoldAmount, amountStyle]}>{amount}</Text>
        <Ionicons
          name={empty ? 'remove' : open ? 'chevron-up' : 'chevron-down'}
          size={16}
          color={SECONDARY}
        />
      </Pressable>
      {open && !empty ? children : null}
    </View>
  );
}

function BullionAuditPanel({
  session,
  onRequireLogin,
  storeFilter,
  embedded = false,
}) {
  const { canFilter } = useAppAccess();
  const allowFilters = canFilter('audit');
  const isMobile = useIsMobile();
  const [date, setDate] = useState(() => parseDateParam(new Date()));
  const [stores, setStores] = useState([]);
  const [selectedStoreName, setSelectedStoreName] = useState(storeFilter || null);
  const [rows, setRows] = useState([]);
  const [historyDates, setHistoryDates] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [confirmed, setConfirmed] = useState({});
  const [savingId, setSavingId] = useState('');
  const [savingAll, setSavingAll] = useState(false);
  const [saveAllProgress, setSaveAllProgress] = useState('');
  const [query, setQuery] = useState('');
  const [hideZero, setHideZero] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [aiStatus, setAiStatus] = useState('idle');
  const [aiProgress, setAiProgress] = useState('');
  const [aiTurns, setAiTurns] = useState([]);
  const [aiMessages, setAiMessages] = useState([]);
  const [aiDraft, setAiDraft] = useState('');
  const [aiError, setAiError] = useState('');
  const requestId = useRef(0);
  const storesRequestId = useRef(0);
  const aiAbortRef = useRef(null);
  const qtyInputRefs = useRef(new Map());
  const nightSaveTimers = useRef(new Map());
  const draftsRef = useRef({});

  const lockedStore = Boolean(storeFilter) || !allowFilters;
  const dateKey = formatDateParam(date);
  const todayKey = formatDateParam(parseDateParam(new Date()));
  const isToday = dateKey === todayKey;
  const modelMeta = getModelMeta(model, MODEL_OPTIONS) || MODEL_OPTIONS[0];
  const aiBusy = aiStatus === 'running';

  const resetAiChat = useCallback(() => {
    aiAbortRef.current?.abort();
    setAiStatus('idle');
    setAiProgress('');
    setAiTurns([]);
    setAiMessages([]);
    setAiDraft('');
    setAiError('');
  }, []);

  const selectedStore = useMemo(() => {
    if (!stores.length) return null;
    if (selectedStoreName) {
      const match = stores.find(
        (store) =>
          store.name.localeCompare(selectedStoreName, undefined, { sensitivity: 'base' }) === 0,
      );
      if (match) return match;
      // When opened from Home → store, never fall back to a different store.
      if (lockedStore) return null;
    }
    if (lockedStore) return null;
    return stores[0];
  }, [stores, selectedStoreName, lockedStore]);

  const txnDrawer = useAuditTxnDrawer(session, {
    token: selectedStore?.token || session?.token,
    baseUrl: selectedStore?.baseUrl || session?.baseUrl,
  });
  const setTxnLookup = txnDrawer.setLookup;
  const closeTxnDrawer = txnDrawer.close;

  useEffect(() => {
    if (storeFilter) setSelectedStoreName(storeFilter);
  }, [storeFilter]);

  useEffect(() => {
    if (!session?.token) {
      setStores([]);
      return;
    }
    const id = ++storesRequestId.current;
    fetchBullionAuditStores(session)
      .then((result) => {
        if (id !== storesRequestId.current) return;
        setStores(result);
        setSelectedStoreName((prev) => {
          if (storeFilter) return storeFilter;
          if (
            prev &&
            result.some(
              (s) => s.name.localeCompare(prev, undefined, { sensitivity: 'base' }) === 0,
            )
          ) {
            return prev;
          }
          return result[0]?.name || null;
        });
        if (
          storeFilter &&
          !result.some(
            (s) => s.name.localeCompare(storeFilter, undefined, { sensitivity: 'base' }) === 0,
          )
        ) {
          setError(`No bullion audit location found for ${storeFilter}.`);
        }
      })
      .catch((err) => {
        if (id !== storesRequestId.current) return;
        setStores([]);
        setError(err?.message || 'Failed to load stores.');
      });
  }, [session, storeFilter]);

  const load = useCallback(async () => {
    if (!session?.token) {
      setRows([]);
      setHistoryDates([]);
      setError('');
      return;
    }
    if (!selectedStore?.id) {
      setRows([]);
      setHistoryDates([]);
      return;
    }

    const id = ++requestId.current;
    setLoading(true);
    setError('');

    try {
      const result = await fetchBullionAudit(session, {
        date: dateKey,
        locationId: selectedStore.id,
        systemKey: selectedStore.systemKey,
        storeName: selectedStore.name,
      });
      if (id !== requestId.current) return;

      setRows(result.rows);
      setHistoryDates(result.historyDates);
      const nextDrafts = {};
      const nextConfirmed = {};
      for (const row of result.rows) {
        nextDrafts[row.id] = {
          vault: qtyInputText(row.vaultCount),
          night: qtyInputText(row.nightCount),
          store: qtyInputText(row.storeCount),
          other: qtyInputText(row.otherCount),
        };
        if (row.amount != null || row.nightCount != null) nextConfirmed[row.id] = true;
      }
      draftsRef.current = nextDrafts;
      setDrafts(nextDrafts);
      setConfirmed(nextConfirmed);
    } catch (err) {
      if (id !== requestId.current) return;
      setRows([]);
      setHistoryDates([]);
      setError(err?.message || 'Failed to load bullion audit.');
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [session, dateKey, selectedStore?.id, selectedStore?.systemKey, selectedStore?.name]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const timers = nightSaveTimers.current;
    return () => {
      aiAbortRef.current?.abort();
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, []);

  useEffect(() => {
    resetAiChat();
    setTxnLookup([]);
    closeTxnDrawer();
  }, [dateKey, selectedStore?.id, selectedStore?.systemKey, resetAiChat, setTxnLookup, closeTxnDrawer]);

  const visibleRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (hideZero && !(row.systemCount > 0 || row.amount > 0 || row.nightCount > 0)) {
        const draft = drafts[row.id];
        const vault = parseQtyInput(draft?.vault);
        const night = parseQtyInput(draft?.night);
        if (!(vault > 0) && !(night > 0)) return false;
      }
      if (!q) return true;
      return [row.name, row.sku, row.metal, row.description]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q));
    });
  }, [rows, query, hideZero, drafts]);

  const unbalancedItems = useMemo(
    () => buildUnbalancedBullionItems(rows, drafts),
    [rows, drafts],
  );

  const clearNightSaveTimer = (productId) => {
    const timers = nightSaveTimers.current;
    const timer = timers.get(productId);
    if (timer) clearTimeout(timer);
    timers.delete(productId);
  };

  const persistNightCount = async (productId, value) => {
    if (!selectedStore?.name) return;
    clearNightSaveTimer(productId);
    const saved = await saveNightCount(
      selectedStore.name,
      productId,
      parseQtyInput(value),
      session?.supabaseUserId,
    );
    setRows((prev) =>
      prev.map((entry) =>
        entry.id === productId
          ? {
              ...entry,
              nightCount: saved,
              amount: countedPhysicalTotal(entry.vaultCount, saved),
            }
          : entry,
      ),
    );
  };

  const scheduleNightSave = (productId, value) => {
    if (!selectedStore?.name) return;
    clearNightSaveTimer(productId);
    const storeName = selectedStore.name;
    const userId = session?.supabaseUserId;
    nightSaveTimers.current.set(
      productId,
      setTimeout(() => {
        nightSaveTimers.current.delete(productId);
        saveNightCount(storeName, productId, parseQtyInput(value), userId).catch((err) => {
          setError(err?.message || 'Failed to save night count.');
        });
      }, 450),
    );
  };

  const setDraftField = (productId, field, value) => {
    setDrafts((prev) => {
      const next = {
        ...prev,
        [productId]: {
          ...emptyQtyDraft(),
          ...(prev[productId] || {}),
          [field]: value,
        },
      };
      draftsRef.current = next;
      return next;
    });
    if (field === 'night') scheduleNightSave(productId, value);
    setConfirmed((prev) => {
      if (field === 'night') {
        return { ...prev, [productId]: true };
      }
      if (!prev[productId]) return prev;
      const next = { ...prev };
      delete next[productId];
      return next;
    });
  };

  const rowHasDraftCounts = (row) => {
    const draft = drafts[row.id] || {};
    return (
      String(draft.vault || '').trim() !== '' ||
      String(draft.store || '').trim() !== '' ||
      String(draft.other || '').trim() !== ''
    );
  };

  const persistRow = async (row) => {
    const draft = draftsRef.current[row.id] || drafts[row.id] || {};
    const vaultCount = parseQtyInput(draft.vault);
    const nightCount = parseQtyInput(draft.night);
    const storeCount = parseQtyInput(draft.store);
    const otherCount = parseQtyInput(draft.other);
    const token = selectedStore.token || session.token;
    const baseUrl = selectedStore.baseUrl || session.baseUrl;
    clearNightSaveTimer(row.id);
    const shouldSaveNight =
      String(draft.night || '').trim() !== '' || row.nightCount != null;
    const [ , savedNight] = await Promise.all([
      saveInventoryLog(
        token,
        {
          productId: row.id,
          locationId: selectedStore.id,
          date: dateKey,
          vaultCount,
          storeCount,
          otherCount,
        },
        baseUrl,
      ),
      shouldSaveNight
        ? saveNightCount(
            selectedStore.name,
            row.id,
            nightCount,
            session?.supabaseUserId,
          )
        : Promise.resolve(row.nightCount ?? null),
    ]);
    const total = countedPhysicalTotal(vaultCount, savedNight);
    return {
      id: row.id,
      vaultCount,
      nightCount: savedNight,
      storeCount,
      otherCount,
      amount: total,
    };
  };

  const updateRow = async (row) => {
    if (
      !(selectedStore?.token || session?.token) ||
      !selectedStore?.id ||
      savingId === row.id ||
      savingAll
    ) {
      return;
    }

    setSavingId(row.id);
    setError('');
    try {
      const saved = await persistRow(row);
      setRows((prev) =>
        prev.map((entry) =>
          entry.id === saved.id
            ? {
                ...entry,
                vaultCount: saved.vaultCount,
                nightCount: saved.nightCount,
                storeCount: saved.storeCount,
                otherCount: saved.otherCount,
                amount: saved.amount,
              }
            : entry,
        ),
      );
      setConfirmed((prev) => ({ ...prev, [saved.id]: true }));
    } catch (err) {
      setError(err?.message || 'Failed to update count.');
    } finally {
      setSavingId('');
    }
  };

  const updateAll = async () => {
    if (
      !(selectedStore?.token || session?.token) ||
      !selectedStore?.id ||
      savingAll ||
      savingId
    ) {
      return;
    }
    const targets = visibleRows.filter(rowHasDraftCounts);
    if (!targets.length) {
      setError('Enter vault/store/other counts on at least one row first.');
      return;
    }

    setSavingAll(true);
    setError('');
    setSaveAllProgress(`Updating 0/${targets.length}…`);

    const savedById = new Map();
    const failures = [];
    const concurrency = 5;
    let next = 0;
    let done = 0;

    const worker = async () => {
      while (next < targets.length) {
        const index = next;
        next += 1;
        const row = targets[index];
        try {
          const saved = await persistRow(row);
          savedById.set(saved.id, saved);
        } catch (err) {
          failures.push({
            name: row.name || row.sku || row.id,
            message: err?.message || 'Failed',
          });
        } finally {
          done += 1;
          setSaveAllProgress(`Updating ${done}/${targets.length}…`);
        }
      }
    };

    try {
      await Promise.all(
        Array.from({ length: Math.min(concurrency, targets.length) }, () => worker()),
      );

      if (savedById.size) {
        setRows((prev) =>
          prev.map((entry) => {
            const saved = savedById.get(entry.id);
            if (!saved) return entry;
            return {
              ...entry,
              vaultCount: saved.vaultCount,
              nightCount: saved.nightCount,
              storeCount: saved.storeCount,
              otherCount: saved.otherCount,
              amount: saved.amount,
            };
          }),
        );
        setConfirmed((prev) => {
          const nextConfirmed = { ...prev };
          for (const id of savedById.keys()) nextConfirmed[id] = true;
          return nextConfirmed;
        });
      }

      if (failures.length) {
        const sample = failures
          .slice(0, 3)
          .map((item) => item.name)
          .join(', ');
        setError(
          `Updated ${savedById.size}/${targets.length}. Failed: ${sample}${
            failures.length > 3 ? ` (+${failures.length - 3} more)` : ''
          }.`,
        );
      }
    } finally {
      setSavingAll(false);
      setSaveAllProgress('');
    }
  };

  const runFindOutWhy = async () => {
    if (
      !(selectedStore?.token || session?.token) ||
      !selectedStore?.id ||
      aiBusy
    ) {
      return;
    }
    if (!unbalancedItems.length) {
      setAiStatus('error');
      setAiError('No unbalanced metals. Enter vault counts (and Update) so +/− is non-zero.');
      return;
    }

    aiAbortRef.current?.abort();
    const controller = new AbortController();
    aiAbortRef.current = controller;

    setAiStatus('running');
    setAiProgress('Starting…');
    setAiTurns([{ role: 'assistant', content: '' }]);
    setAiMessages([]);
    setAiDraft('');
    setAiError('');
    setModelMenuOpen(false);

    try {
      const result = await analyzeBullionDiscrepancy({
        session,
        date: dateKey,
        storeName: selectedStore.name,
        locationId: selectedStore.id,
        systemKey: selectedStore.systemKey,
        unbalancedItems,
        model,
        signal: controller.signal,
        onProgress: setAiProgress,
        onDelta: (_chunk, full) => {
          setAiTurns([{ role: 'assistant', content: full || '' }]);
        },
      });
      if (controller.signal.aborted) return;
      setAiTurns([{ role: 'assistant', content: result.text || '' }]);
      setAiMessages(result.messages || []);
      txnDrawer.setLookup(result.context?.lookupTransactions || []);
      setAiStatus('done');
      setAiProgress('');
    } catch (err) {
      if (controller.signal.aborted) {
        setAiStatus('idle');
        setAiProgress('');
        return;
      }
      setAiStatus('error');
      setAiError(err?.message || 'AI analysis failed.');
      setAiProgress('');
      setAiTurns((prev) => {
        if (
          prev.length === 1 &&
          prev[0]?.role === 'assistant' &&
          !String(prev[0].content || '').trim()
        ) {
          return [];
        }
        return prev;
      });
    }
  };

  const sendAiFollowUp = async () => {
    const question = String(aiDraft || '').trim();
    if (!question || aiBusy || !aiMessages.length) return;

    aiAbortRef.current?.abort();
    const controller = new AbortController();
    aiAbortRef.current = controller;

    setAiStatus('running');
    setAiProgress('Replying…');
    setAiError('');
    setAiDraft('');
    setAiTurns((prev) => [
      ...prev,
      { role: 'user', content: question },
      { role: 'assistant', content: '' },
    ]);

    try {
      const result = await continueBullionAuditChat({
        messages: aiMessages,
        userMessage: question,
        model,
        signal: controller.signal,
        onDelta: (_chunk, full) => {
          setAiTurns((prev) => {
            if (!prev.length) return prev;
            const next = prev.slice();
            next[next.length - 1] = { role: 'assistant', content: full || '' };
            return next;
          });
        },
      });
      if (controller.signal.aborted) return;
      setAiTurns((prev) => {
        if (!prev.length) return prev;
        const next = prev.slice();
        next[next.length - 1] = { role: 'assistant', content: result.text || '' };
        return next;
      });
      setAiMessages(result.messages || []);
      setAiStatus('done');
      setAiProgress('');
    } catch (err) {
      if (controller.signal.aborted) {
        setAiStatus('done');
        setAiProgress('');
        return;
      }
      setAiStatus('error');
      setAiError(err?.message || 'Follow-up failed.');
      setAiProgress('');
      setAiTurns((prev) => {
        if (prev.length < 2) return prev;
        const last = prev[prev.length - 1];
        if (last?.role === 'assistant' && !String(last.content || '').trim()) {
          return prev.slice(0, -1);
        }
        return prev;
      });
    }
  };

  if (!session?.token) {
    return (
      <View style={styles.body}>
        <Text style={styles.hint}>
          Sign in to audit bullion.{' '}
          {onRequireLogin ? (
            <Text style={styles.link} onPress={onRequireLogin}>
              Go to Profile
            </Text>
          ) : null}
        </Text>
      </View>
    );
  }

  const renderBullionAi = () => {
    const content = (
      <GroupSection title="Doesn't balance">
        <View style={[styles.statRow, !unbalancedItems.length && styles.statRowLast]}>
          <Text style={styles.statLabel}>
            {unbalancedItems.length
              ? `${unbalancedItems.length} metal${unbalancedItems.length === 1 ? '' : 's'} off vs system`
              : 'All entered counts match system'}
          </Text>
        </View>

        {unbalancedItems.length ? (
          <View style={styles.unbalanceList}>
            {unbalancedItems.slice(0, 12).map((item, index) => (
              <View
                key={item.id}
                style={[
                  styles.statRow,
                  index === Math.min(unbalancedItems.length, 12) - 1 &&
                    !unbalancedItems.length &&
                    styles.statRowLast,
                ]}
              >
                <Text style={styles.statLabel} numberOfLines={1}>
                  {item.name}
                </Text>
                <Text
                  style={[
                    styles.statValue,
                    item.diff < 0 ? styles.short : styles.over,
                  ]}
                >
                  {item.diffLabel}
                </Text>
              </View>
            ))}
          </View>
        ) : null}

        <View style={[styles.aiRow, isMobile && styles.aiRowMobile]}>
          <View style={[styles.modelDropdownWrap, isMobile && styles.modelDropdownWrapMobile]}>
            <Pressable
              style={[styles.modelDropdown, modelMenuOpen && styles.modelDropdownOpen]}
              onPress={() => setModelMenuOpen((open) => !open)}
            >
              <View style={styles.modelDropdownMain}>
                <Text style={styles.modelDropdownValue} numberOfLines={1}>
                  {modelMeta.label}
                </Text>
                <Text style={styles.modelDropdownMeta} numberOfLines={1}>
                  {modelOptionMetaLine(modelMeta)}
                </Text>
              </View>
              <Ionicons
                name={modelMenuOpen ? 'chevron-up' : 'chevron-down'}
                size={16}
                color={SECONDARY}
              />
            </Pressable>

            {modelMenuOpen ? (
              <ScrollView style={styles.modelMenu} nestedScrollEnabled>
                {MODEL_OPTIONS.map((option) => {
                  const active = option.key === model;
                  return (
                    <Pressable
                      key={option.key}
                      style={[styles.modelOption, active && styles.modelOptionActive]}
                      onPress={() => {
                        setModel(option.key);
                        setModelMenuOpen(false);
                      }}
                    >
                      <View style={styles.modelOptionCopy}>
                        <Text
                          style={[
                            styles.modelOptionText,
                            active && styles.modelOptionTextActive,
                          ]}
                        >
                          {option.label}
                        </Text>
                        <Text style={styles.modelOptionStats}>
                          {modelOptionMetaLine(option)}
                        </Text>
                        {option.blurb ? (
                          <Text style={styles.modelOptionBlurb}>{option.blurb}</Text>
                        ) : null}
                      </View>
                      {active ? <Ionicons name="checkmark" size={16} color={ACCENT} /> : null}
                    </Pressable>
                  );
                })}
              </ScrollView>
            ) : null}
          </View>

          <Pressable
            style={[
              styles.findWhyButton,
              isMobile && styles.findWhyButtonMobile,
              (aiBusy || !unbalancedItems.length) && styles.findWhyButtonDisabled,
            ]}
            onPress={runFindOutWhy}
            disabled={aiBusy || !unbalancedItems.length}
          >
            {aiBusy && !aiMessages.length ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Ionicons name="sparkles" size={16} color="#fff" />
            )}
            <Text style={styles.findWhyButtonText}>
              {aiBusy && !aiMessages.length ? 'Analyzing…' : 'Find out why'}
            </Text>
          </Pressable>
        </View>

        {aiBusy && aiProgress ? (
          <Text style={styles.aiProgress}>{aiProgress}</Text>
        ) : null}
        {aiStatus === 'error' && aiError ? (
          <Text style={[styles.errorText, styles.aiProgress]}>{aiError}</Text>
        ) : null}
        <View style={styles.aiChatWrap}>
          <AuditAiChat
            turns={aiTurns}
            draft={aiDraft}
            onChangeDraft={setAiDraft}
            onSend={sendAiFollowUp}
            busy={aiBusy}
            disabled={!aiMessages.length}
            placeholder="Ask about a metal, SO/PO, or next check…"
            onOpenReference={txnDrawer.openReference}
          />
        </View>
      </GroupSection>
    );

    return content;
  };


  const storeSelectOptions = stores.map((store) => ({
    value: store.name,
    label: store.name,
  }));

  const renderSearchField = (style) => (
    <View style={[styles.appleSearch, style]}>
      <Ionicons name="search" size={16} color={SECONDARY} style={styles.appleSearchIcon} />
      <TextInput
        style={styles.appleSearchInput}
        value={query}
        onChangeText={setQuery}
        placeholder="Search"
        placeholderTextColor={SECONDARY}
        autoCapitalize="none"
        autoCorrect={false}
        clearButtonMode="while-editing"
      />
      {query ? (
        <Pressable onPress={() => setQuery('')} hitSlop={8}>
          <Ionicons name="close-circle" size={18} color={CHEVRON} />
        </Pressable>
      ) : null}
    </View>
  );

  const renderZeroFilter = () =>
    allowFilters ? (
      !isMobile ? (
        <SegmentedControl
          options={[
            { key: 'nonzero', label: 'Non-zero' },
            { key: 'all', label: 'All' },
          ]}
          value={hideZero ? 'nonzero' : 'all'}
          onChange={(next) => setHideZero(next === 'nonzero')}
        />
      ) : (
        <Pressable
          style={[styles.iconToggle, hideZero && styles.iconToggleActive]}
          onPress={() => setHideZero((prev) => !prev)}
          accessibilityLabel={hideZero ? 'Showing non-zero' : 'Showing all'}
        >
          <Ionicons
            name={hideZero ? 'filter' : 'filter-outline'}
            size={16}
            color={hideZero ? TEXT : SECONDARY}
          />
        </Pressable>
      )
    ) : null;

  const renderStoreControl = (selectStyle) =>
    lockedStore ? (
      <Text style={[styles.storeTitle, isMobile && styles.storeTitleMobile]} numberOfLines={1}>
        {selectedStore?.name || storeFilter || 'Store'}
      </Text>
    ) : (
      <FilterSelect
        label="Store"
        value={selectedStore?.name || selectedStoreName}
        options={storeSelectOptions}
        onChange={setSelectedStoreName}
        style={[styles.storeSelect, selectStyle]}
      />
    );

  const renderRefreshButton = () => (
    <Pressable
      style={styles.iconToggle}
      onPress={load}
      disabled={loading}
      accessibilityLabel="Refresh"
    >
      {loading ? (
        <ActivityIndicator size="small" color={SECONDARY} />
      ) : (
        <Ionicons name="refresh" size={16} color={TEXT} />
      )}
    </Pressable>
  );

  const renderUpdateAllButton = (style) => {
    const canUpdateAll = visibleRows.some(rowHasDraftCounts);
    return (
      <Pressable
        style={[
          styles.fillButton,
          style,
          (savingAll || savingId || !canUpdateAll) && styles.fillButtonDisabled,
        ]}
        onPress={updateAll}
        disabled={savingAll || Boolean(savingId) || !canUpdateAll}
      >
        {savingAll ? (
          <Text style={styles.fillButtonText} numberOfLines={1}>
            {saveAllProgress || 'Updating…'}
          </Text>
        ) : (
          <Text style={styles.fillButtonText} numberOfLines={1}>
            Update all
          </Text>
        )}
      </Pressable>
    );
  };

  const renderBullionToolbar = () => {
    if (isMobile) {
      return (
        <View style={styles.mobileToolbar}>
          {renderSearchField(styles.appleSearchMobile)}
          {renderStoreControl(styles.storeSelectMobile)}
          <View style={styles.mobileToolbarRow}>
            {renderZeroFilter()}
            <SegmentedControl
              options={[{ key: 'today', label: 'Today' }]}
              value={isToday ? 'today' : ''}
              onChange={() => setDate(parseDateParam(new Date()))}
            />
            <DateChip label="Date" value={date} onChange={setDate} maximumDate={new Date()} />
            {renderRefreshButton()}
          </View>
          {renderUpdateAllButton(styles.fillButtonMobile)}
        </View>
      );
    }
    return (
      <FilterBar>
        {renderSearchField()}
        {renderZeroFilter()}
        {renderStoreControl()}
        <SegmentedControl
          options={[{ key: 'today', label: 'Today' }]}
          value={isToday ? 'today' : ''}
          onChange={() => setDate(parseDateParam(new Date()))}
        />
        <DateChip label="Date" value={date} onChange={setDate} maximumDate={new Date()} />
        {renderRefreshButton()}
        {renderUpdateAllButton()}
      </FilterBar>
    );
  };

  const registerQtyInput = (rowId, field) => (node) => {
    const key = `${rowId}:${field}`;
    if (node) qtyInputRefs.current.set(key, node);
    else qtyInputRefs.current.delete(key);
  };

  const focusNextQtyInput = (rowIndex, field) => {
    const fieldIndex = QTY_FIELDS.indexOf(field);
    const wrap = fieldIndex >= QTY_FIELDS.length - 1;
    const nextField = wrap ? QTY_FIELDS[0] : QTY_FIELDS[fieldIndex + 1];
    const nextRow = visibleRows[wrap ? rowIndex + 1 : rowIndex];
    if (!nextRow) return;
    const node = qtyInputRefs.current.get(`${nextRow.id}:${nextField}`);
    if (node && typeof node.focus === 'function') node.focus();
  };

  return (
    <View style={[styles.panelBody, embedded && styles.panelBodyEmbedded, isMobile && styles.panelBodyMobile]}>
      {renderBullionToolbar()}

      <View style={styles.metaRow}>
        <Text style={styles.metaText} numberOfLines={1}>
          {loading && !rows.length
            ? 'Loading…'
            : `${visibleRows.length}${
                visibleRows.length !== rows.length ? ` of ${rows.length}` : ''
              } item${visibleRows.length === 1 ? '' : 's'}${
                unbalancedItems.length
                  ? ` · ${unbalancedItems.length} off`
                  : ''
              } · ${isToday ? 'Today' : formatPickerDate(date)}`}
        </Text>
        {loading && rows.length > 0 ? (
          <ActivityIndicator size="small" color={SECONDARY} />
        ) : null}
      </View>

      {error ? <Text style={[styles.errorText, styles.metaError]}>{error}</Text> : null}

      <ScrollView
        style={styles.appleScroll}
        contentContainerStyle={styles.appleScrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
      >
        {loading && !rows.length ? (
          <View style={[styles.centered, embedded && styles.centeredEmbedded]}>
            <ActivityIndicator color={TEXT} />
          </View>
        ) : !visibleRows.length ? (
          <Text style={styles.emptyText}>
            {query.trim()
              ? `No items match “${query.trim()}”.`
              : 'No bullion items match these filters.'}
          </Text>
        ) : isMobile ? (
          <View style={styles.bMobileStack}>
            {visibleRows.map((row, rowIndex) => {
              const draft = drafts[row.id] || emptyQtyDraft();
              const isSaving = savingId === row.id;
              const showDiff = draftShowsDiff(draft, confirmed[row.id]);
              const metal = metalGroupLabel(row);
              const prevMetal =
                rowIndex === 0 ? null : metalGroupLabel(visibleRows[rowIndex - 1]);
              return (
                <Fragment key={row.id}>
                  {metal !== prevMetal ? (
                    <View style={styles.bMobileSection}>
                      <View
                        style={[
                          styles.bullionMetalDot,
                          { backgroundColor: metalAccent(row.metal) },
                        ]}
                      />
                      <Text style={styles.bMobileSectionTitle}>{metal}</Text>
                    </View>
                  ) : null}
                  <BullionMobileCard
                    row={row}
                    draft={draft}
                    historyDates={historyDates}
                    isSaving={isSaving}
                    savingAll={savingAll}
                    showDiff={showDiff}
                    onChangeField={(field, value) => setDraftField(row.id, field, value)}
                    onBlurField={(field) => {
                      if (field !== 'night') return;
                      const next = parseQtyInput(draftsRef.current[row.id]?.night);
                      if (next == null && row.nightCount == null) return;
                      persistNightCount(row.id, draftsRef.current[row.id]?.night).catch((err) => {
                        setError(err?.message || 'Failed to save night count.');
                      });
                    }}
                    onUpdate={() => updateRow(row)}
                    registerQtyInput={(field) => registerQtyInput(row.id, field)}
                    onSubmitField={(field) => {
                      if (field === 'night') {
                        const next = parseQtyInput(draftsRef.current[row.id]?.night);
                        if (next != null || row.nightCount != null) {
                          persistNightCount(row.id, draftsRef.current[row.id]?.night).catch((err) => {
                            setError(err?.message || 'Failed to save night count.');
                          });
                        }
                      }
                      focusNextQtyInput(rowIndex, field);
                    }}
                  />
                </Fragment>
              );
            })}
          </View>
        ) : (
          <View style={styles.bullionTableCard}>
            <ScrollView
              horizontal
              nestedScrollEnabled
              keyboardShouldPersistTaps="handled"
              showsHorizontalScrollIndicator
              style={styles.bullionTableScroll}
              contentContainerStyle={styles.bullionTableScrollContent}
            >
              <View
                style={[
                  styles.bullionTable,
                  {
                    minWidth:
                      BULLION_TABLE_BASE_WIDTH +
                      historyDates.length * BULLION_HIST_COL_WIDTH,
                  },
                ]}
              >
                <View style={[styles.bullionRow, styles.bullionHeaderRow]}>
                  <View style={styles.bAccent} />
                  <Text style={[styles.bullionH, styles.bColItem]}>Item</Text>
                  {historyDates.map((day) => (
                    <Text key={day} style={[styles.bullionH, styles.bColHist]} numberOfLines={1}>
                      {formatWeekColumnLabel(day)}
                    </Text>
                  ))}
                  <Text style={[styles.bullionH, styles.bColNum]}>Sys</Text>
                  {QTY_FIELDS.map((field) => (
                    <Text
                      key={field}
                      style={[styles.bullionH, styles.bColInput, styles.bullionHFill]}
                    >
                      {QTY_HEADER_LABELS[field]}
                    </Text>
                  ))}
                  <Text style={[styles.bullionH, styles.bColNum]}>Tot</Text>
                  <View style={styles.bColDiff} />
                  <View style={styles.bColAction} />
                </View>
                {visibleRows.map((row, rowIndex) => {
                  const draft = drafts[row.id] || emptyQtyDraft();
                  const isSaving = savingId === row.id;
                  const showDiff = draftShowsDiff(draft, confirmed[row.id]);
                  const metal = metalGroupLabel(row);
                  const prevMetal =
                    rowIndex === 0 ? null : metalGroupLabel(visibleRows[rowIndex - 1]);
                  return (
                    <Fragment key={row.id}>
                      {metal !== prevMetal ? (
                        <View style={styles.bullionMetalHeader}>
                          <View
                            style={[
                              styles.bullionMetalDot,
                              { backgroundColor: metalAccent(row.metal) },
                            ]}
                          />
                          <Text style={styles.bullionMetalTitle}>{metal}</Text>
                        </View>
                      ) : null}
                      <BullionTableRow
                        row={row}
                        draft={draft}
                        historyDates={historyDates}
                        dense
                        striped={rowIndex % 2 === 1}
                        isSaving={isSaving}
                        savingAll={savingAll}
                        showDiff={showDiff}
                        onChangeField={(field, value) => setDraftField(row.id, field, value)}
                        onBlurField={(field) => {
                          if (field !== 'night') return;
                          const next = parseQtyInput(draftsRef.current[row.id]?.night);
                          if (next == null && row.nightCount == null) return;
                          persistNightCount(row.id, draftsRef.current[row.id]?.night).catch((err) => {
                            setError(err?.message || 'Failed to save night count.');
                          });
                        }}
                        onUpdate={() => updateRow(row)}
                        registerQtyInput={(field) => registerQtyInput(row.id, field)}
                        onSubmitField={(field) => {
                          if (field === 'night') {
                            const next = parseQtyInput(draftsRef.current[row.id]?.night);
                            if (next != null || row.nightCount != null) {
                              persistNightCount(row.id, draftsRef.current[row.id]?.night).catch((err) => {
                                setError(err?.message || 'Failed to save night count.');
                              });
                            }
                          }
                          focusNextQtyInput(rowIndex, field);
                        }}
                      />
                    </Fragment>
                  );
                })}
              </View>
            </ScrollView>
          </View>
        )}

        {renderBullionAi()}
      </ScrollView>

      <AuditTxnDrawer
        visible={txnDrawer.visible}
        summary={txnDrawer.summary}
        detail={txnDrawer.detail}
        loading={txnDrawer.loading}
        error={txnDrawer.error}
        onClose={txnDrawer.close}
      />
    </View>
  );
}

function CashAuditPanel({
  session,
  onRequireLogin,
  storeFilter,
  embedded = false,
}) {
  const { canFilter } = useAppAccess();
  const allowFilters = canFilter('audit');
  const isMobile = useIsMobile();
  const [date, setDate] = useState(() => parseDateParam(new Date()));
  const [selectedStore, setSelectedStore] = useState(
    storeFilter || AUDIT_CASH_STORES[0] || null,
  );
  const [position, setPosition] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const [looseCounts, setLooseCounts] = useState(emptyDenomCounts);
  const [stackCounts, setStackCounts] = useState(emptyDenomCounts);
  const [otherCashText, setOtherCashText] = useState('');
  const [countedTotalText, setCountedTotalText] = useState('');
  const [countedManual, setCountedManual] = useState(false);
  const [usdLooseCounts, setUsdLooseCounts] = useState(() => emptyDenomCounts(USD_DENOMS));
  const [usdStackCounts, setUsdStackCounts] = useState(() => emptyDenomCounts(USD_DENOMS));
  const [usdOtherCashText, setUsdOtherCashText] = useState('');
  const [usdCountedTotalText, setUsdCountedTotalText] = useState('');
  const [usdCountedManual, setUsdCountedManual] = useState(false);
  const [cashDrawer, setCashDrawer] = useState('cad');
  const [paymentsOpen, setPaymentsOpen] = useState(false);
  const [tillOpen, setTillOpen] = useState(false);
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [aiStatus, setAiStatus] = useState('idle');
  const [aiProgress, setAiProgress] = useState('');
  const [aiTurns, setAiTurns] = useState([]);
  const [aiMessages, setAiMessages] = useState([]);
  const [aiDraft, setAiDraft] = useState('');
  const [aiError, setAiError] = useState('');
  const requestId = useRef(0);
  const aiAbortRef = useRef(null);
  const cashInputRefs = useRef(new Map());

  const lockedStore = Boolean(storeFilter) || !allowFilters;
  const dateKey = formatDateParam(date);
  const todayKey = formatDateParam(parseDateParam(new Date()));
  const isToday = dateKey === todayKey;
  const aiBusy = aiStatus === 'running';

  const resetAiChat = useCallback(() => {
    aiAbortRef.current?.abort();
    setAiStatus('idle');
    setAiProgress('');
    setAiTurns([]);
    setAiMessages([]);
    setAiDraft('');
    setAiError('');
  }, []);

  const txnDrawer = useAuditTxnDrawer(session, {
    token: session?.token,
    baseUrl: session?.baseUrl,
  });
  const setTxnLookup = txnDrawer.setLookup;
  const closeTxnDrawer = txnDrawer.close;

  const storeOptions = useMemo(() => {
    const names = new Set(AUDIT_CASH_STORES);
    if (storeFilter) names.add(storeFilter);
    if (position?.storeName) names.add(position.storeName);
    return Array.from(names).sort((a, b) => {
      const aQc = QUEBEC_STORES.includes(a);
      const bQc = QUEBEC_STORES.includes(b);
      if (aQc !== bQc) return aQc ? 1 : -1;
      return a.localeCompare(b, undefined, { sensitivity: 'base' });
    });
  }, [storeFilter, position?.storeName]);

  useEffect(() => {
    if (storeFilter) setSelectedStore(storeFilter);
  }, [storeFilter]);

  const load = useCallback(async () => {
    if (!session?.token) {
      setPosition(null);
      setError('');
      setWarning('');
      return;
    }
    if (!selectedStore) {
      setPosition(null);
      setError('Select a store.');
      return;
    }

    const id = ++requestId.current;
    setLoading(true);
    setError('');
    setWarning('');

    try {
      const result = await fetchStoreCashPosition(session, {
        date: dateKey,
        storeName: selectedStore,
      });
      if (id !== requestId.current) return;
      setPosition(result);
      setWarning(result.warning || '');
    } catch (err) {
      if (id !== requestId.current) return;
      setPosition(null);
      setError(err?.message || 'Failed to load cash position.');
      setWarning('');
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [session, dateKey, selectedStore]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setLooseCounts(emptyDenomCounts());
    setStackCounts(emptyDenomCounts());
    setOtherCashText('');
    setCountedTotalText('');
    setCountedManual(false);
    setUsdLooseCounts(emptyDenomCounts(USD_DENOMS));
    setUsdStackCounts(emptyDenomCounts(USD_DENOMS));
    setUsdOtherCashText('');
    setUsdCountedTotalText('');
    setUsdCountedManual(false);
    setCashDrawer('cad');
    setPaymentsOpen(false);
    setTillOpen(false);
  }, [dateKey, selectedStore]);

  useEffect(() => {
    return () => {
      aiAbortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    resetAiChat();
    setTxnLookup([]);
    closeTxnDrawer();
  }, [dateKey, selectedStore, resetAiChat, setTxnLookup, closeTxnDrawer]);

  const isUsdDrawer = cashDrawer === 'usd';
  const currency = isUsdDrawer ? 'USD' : 'CAD';
  const drawerLabel = isUsdDrawer ? 'USD' : 'Till 1 CAD';
  const money = (value) => formatAmount(value, currency);
  const activeDenoms = isUsdDrawer ? USD_DENOMS : CASH_DENOMS;
  const activeDrawer = isUsdDrawer ? position?.usd : position?.cad;
  const paymentRows = activeDrawer?.paymentRows || [];
  const cashTxnRows = activeDrawer?.cashTransactions || [];
  const paymentTotals = activeDrawer?.paymentTotals || EMPTY_CASH_TOTALS;
  const cashTxnTotals = activeDrawer?.cashTxnTotals || EMPTY_CASH_TOTALS;
  const yesterdayClosing = activeDrawer?.yesterdayClosing ?? 0;
  const openingBalance = activeDrawer?.openingBalance ?? 0;
  const expectedOnHand = activeDrawer?.expectedOnHand ?? 0;
  const posPhysical = activeDrawer?.todayPhysical ?? 0;
  const previousDateLabel = position?.previousDate
    ? formatPickerDate(parseDateParam(position.previousDate))
    : 'Yesterday';

  const activeLooseCounts = isUsdDrawer ? usdLooseCounts : looseCounts;
  const activeStackCounts = isUsdDrawer ? usdStackCounts : stackCounts;
  const activeOtherCashText = isUsdDrawer ? usdOtherCashText : otherCashText;
  const setActiveLooseCounts = isUsdDrawer ? setUsdLooseCounts : setLooseCounts;
  const setActiveStackCounts = isUsdDrawer ? setUsdStackCounts : setStackCounts;
  const setActiveOtherCashText = isUsdDrawer ? setUsdOtherCashText : setOtherCashText;
  const activeCountedTotalText = isUsdDrawer ? usdCountedTotalText : countedTotalText;
  const setActiveCountedTotalText = isUsdDrawer ? setUsdCountedTotalText : setCountedTotalText;
  const activeCountedManual = isUsdDrawer ? usdCountedManual : countedManual;
  const setActiveCountedManual = isUsdDrawer ? setUsdCountedManual : setCountedManual;

  const cadDenom = computeCountedFromDenoms(
    CASH_DENOMS,
    looseCounts,
    stackCounts,
    otherCashText,
  );
  const usdDenom = computeCountedFromDenoms(
    USD_DENOMS,
    usdLooseCounts,
    usdStackCounts,
    usdOtherCashText,
  );
  const denomColumnTotals = isUsdDrawer ? usdDenom.columns : cadDenom.columns;
  const otherTotal = isUsdDrawer ? usdDenom.otherTotal : cadDenom.otherTotal;

  useEffect(() => {
    if (cadDenom.total == null) return;
    setCountedManual(false);
    setCountedTotalText(cadDenom.total.toFixed(2));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-sync when CAD worksheet inputs change
  }, [looseCounts, stackCounts, otherCashText]);

  useEffect(() => {
    if (usdDenom.total == null) return;
    setUsdCountedManual(false);
    setUsdCountedTotalText(usdDenom.total.toFixed(2));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-sync when USD worksheet inputs change
  }, [usdLooseCounts, usdStackCounts, usdOtherCashText]);

  const cadCashOnHand = parseMoneyInput(countedTotalText);
  const usdCashOnHand = parseMoneyInput(usdCountedTotalText);
  const cashOnHand = isUsdDrawer ? usdCashOnHand : cadCashOnHand;
  const hasCount = cashOnHand != null;
  const variance = hasCount ? cashOnHand - expectedOnHand : null;
  const balanced = variance != null && Math.abs(variance) < 0.005;
  const modelMeta = getModelMeta(model, MODEL_OPTIONS) || MODEL_OPTIONS[0];

  const runFindOutWhy = async () => {
    if (!session?.token || !selectedStore || aiBusy) return;

    aiAbortRef.current?.abort();
    const controller = new AbortController();
    aiAbortRef.current = controller;

    setAiStatus('running');
    setAiProgress('Starting…');
    setAiTurns([{ role: 'assistant', content: '' }]);
    setAiMessages([]);
    setAiDraft('');
    setAiError('');

    try {
      const result = await analyzeCashDiscrepancy({
        session,
        date: dateKey,
        storeName: selectedStore,
        cashOnHand: cadCashOnHand,
        cashOnHandUsd: usdCashOnHand,
        expectedNet: position?.cad?.expectedOnHand ?? expectedOnHand,
        model,
        signal: controller.signal,
        onProgress: setAiProgress,
        onDelta: (_chunk, full) => {
          setAiTurns([{ role: 'assistant', content: full || '' }]);
        },
      });
      if (controller.signal.aborted) return;
      setAiTurns([{ role: 'assistant', content: result.text || '' }]);
      setAiMessages(result.messages || []);
      txnDrawer.setLookup(result.context?.lookupTransactions || []);
      setAiStatus('done');
      setAiProgress('');
    } catch (err) {
      if (controller.signal.aborted) {
        setAiStatus('idle');
        setAiProgress('');
        return;
      }
      setAiStatus('error');
      setAiError(err?.message || 'AI analysis failed.');
      setAiProgress('');
      setAiTurns((prev) => {
        if (
          prev.length === 1 &&
          prev[0]?.role === 'assistant' &&
          !String(prev[0].content || '').trim()
        ) {
          return [];
        }
        return prev;
      });
    }
  };

  const sendAiFollowUp = async () => {
    const question = String(aiDraft || '').trim();
    if (!question || aiBusy || !aiMessages.length) return;

    aiAbortRef.current?.abort();
    const controller = new AbortController();
    aiAbortRef.current = controller;

    setAiStatus('running');
    setAiProgress('Replying…');
    setAiError('');
    setAiDraft('');
    setAiTurns((prev) => [
      ...prev,
      { role: 'user', content: question },
      { role: 'assistant', content: '' },
    ]);

    try {
      const result = await continueCashAuditChat({
        messages: aiMessages,
        userMessage: question,
        model,
        signal: controller.signal,
        onDelta: (_chunk, full) => {
          setAiTurns((prev) => {
            if (!prev.length) return prev;
            const next = prev.slice();
            next[next.length - 1] = { role: 'assistant', content: full || '' };
            return next;
          });
        },
      });
      if (controller.signal.aborted) return;
      setAiTurns((prev) => {
        if (!prev.length) return prev;
        const next = prev.slice();
        next[next.length - 1] = { role: 'assistant', content: result.text || '' };
        return next;
      });
      setAiMessages(result.messages || []);
      setAiStatus('done');
      setAiProgress('');
    } catch (err) {
      if (controller.signal.aborted) {
        setAiStatus('done');
        setAiProgress('');
        return;
      }
      setAiStatus('error');
      setAiError(err?.message || 'Follow-up failed.');
      setAiProgress('');
      setAiTurns((prev) => {
        if (prev.length < 2) return prev;
        const last = prev[prev.length - 1];
        if (last?.role === 'assistant' && !String(last.content || '').trim()) {
          return prev.slice(0, -1);
        }
        return prev;
      });
    }
  };

  const renderAiSection = () => (
    <>
      {aiBusy && aiProgress ? (
        <Text style={styles.aiProgress}>{aiProgress}</Text>
      ) : null}
      {aiError ? <Text style={styles.errorText}>{aiError}</Text> : null}
      <AuditAiChat
        turns={aiTurns}
        draft={aiDraft}
        onChangeDraft={setAiDraft}
        onSend={sendAiFollowUp}
        busy={aiBusy}
        disabled={!aiMessages.length}
        placeholder="Ask about Till 1 CAD, USD, a payment, or till entry…"
        onOpenReference={txnDrawer.openReference}
      />
    </>
  );

  if (!session?.token) {
    return (
      <View style={styles.body}>
        <Text style={styles.hint}>
          Sign in to audit cash.{' '}
          {onRequireLogin ? (
            <Text style={styles.link} onPress={onRequireLogin}>
              Go to Profile
            </Text>
          ) : null}
        </Text>
      </View>
    );
  }

  const registerCashInput = (key) => (node) => {
    if (node) cashInputRefs.current.set(key, node);
    else cashInputRefs.current.delete(key);
  };

  const focusNextCashInput = (key) => {
    const order = [];
    for (const denom of activeDenoms) {
      order.push(`${denom.key}:loose`, `${denom.key}:stacks`);
    }
    order.push('other');
    const next = order[order.indexOf(key) + 1];
    if (!next) return;
    const node = cashInputRefs.current.get(next);
    if (node && typeof node.focus === 'function') node.focus();
  };

  const renderCashToolbar = () => {
    const storeControl = lockedStore ? (
      <Text style={[styles.storeTitle, isMobile && styles.storeTitleMobile]} numberOfLines={1}>
        {selectedStore || 'Store'}
      </Text>
    ) : (
      <FilterSelect
        label="Store"
        value={selectedStore}
        options={storeOptions.map((name) => ({ value: name, label: name }))}
        onChange={setSelectedStore}
        style={[styles.storeSelect, isMobile && styles.storeSelectMobile]}
      />
    );
    const drawerControl = (
      <SegmentedControl
        style={isMobile ? undefined : styles.drawerSegment}
        stretch={isMobile}
        options={CASH_DRAWERS.map((drawer) => ({
          key: drawer.key,
          label: drawer.key === 'usd' ? 'USD' : 'CAD',
        }))}
        value={cashDrawer}
        onChange={setCashDrawer}
      />
    );
    const dateRow = (
      <>
        <SegmentedControl
          options={[{ key: 'today', label: 'Today' }]}
          value={isToday ? 'today' : ''}
          onChange={() => setDate(parseDateParam(new Date()))}
        />
        <DateChip label="Date" value={date} onChange={setDate} maximumDate={new Date()} />
        <Pressable
          style={styles.iconToggle}
          onPress={load}
          disabled={loading}
          accessibilityLabel="Refresh"
        >
          {loading ? (
            <ActivityIndicator size="small" color={SECONDARY} />
          ) : (
            <Ionicons name="refresh" size={16} color={TEXT} />
          )}
        </Pressable>
      </>
    );

    if (isMobile) {
      return (
        <View style={styles.mobileToolbar}>
          {storeControl}
          {drawerControl}
          <View style={styles.mobileToolbarRow}>{dateRow}</View>
        </View>
      );
    }

    return (
      <FilterBar>
        {storeControl}
        {drawerControl}
        {dateRow}
      </FilterBar>
    );
  };

  const renderCashHero = () => {
    const varianceTone = !hasCount
      ? null
      : balanced
        ? 'ok'
        : variance > 0
          ? 'over'
          : 'short';
    const varianceLabel = !hasCount
      ? '—'
      : balanced
        ? 'Balanced'
        : `${variance > 0 ? 'Over' : 'Short'} ${money(Math.abs(variance))}`;
    const trail = (
      <View style={styles.cashTrail}>
        <Text style={styles.cashTrailText}>Open {money(openingBalance)}</Text>
        <Text style={styles.cashTrailDot}>·</Text>
        <Text
          style={[
            styles.cashTrailText,
            paymentTotals.net >= 0 ? styles.cashIn : styles.cashOut,
          ]}
        >
          Pay {money(paymentTotals.net)}
        </Text>
        <Text style={styles.cashTrailDot}>·</Text>
        <Text
          style={[
            styles.cashTrailText,
            cashTxnTotals.net >= 0 ? styles.cashIn : styles.cashOut,
          ]}
        >
          Till {money(cashTxnTotals.net)}
        </Text>
        <Text style={styles.cashTrailDot}>·</Text>
        <Text style={styles.cashTrailText}>
          {previousDateLabel} {money(yesterdayClosing)}
        </Text>
      </View>
    );

    if (isMobile) {
      return (
        <View style={styles.cashHeroBlock}>
          <View style={styles.group}>
            <View style={styles.cashMobileHeroRow}>
              <View style={styles.cashMobileHeroCopy}>
                <Text style={styles.cashMobileHeroLabel}>Expected</Text>
                <Text style={styles.cashMobileHeroMeta}>
                  {posPhysical > 0 ? `POS ${money(posPhysical)}` : 'POS not counted'}
                </Text>
              </View>
              <Text style={styles.cashMobileHeroValue}>{money(expectedOnHand)}</Text>
            </View>
            <View style={styles.cashMobileHeroRow}>
              <View style={styles.cashMobileHeroCopy}>
                <Text style={styles.cashMobileHeroLabel}>Counted</Text>
                <Text style={styles.cashMobileHeroMeta}>
                  {hasCount
                    ? activeCountedManual
                      ? 'Manual total'
                      : 'From worksheet'
                    : 'Enter loose / stacks'}
                </Text>
              </View>
              <Text style={styles.cashMobileHeroValue}>{hasCount ? money(cashOnHand) : '—'}</Text>
            </View>
            <View
              style={[
                styles.cashMobileHeroRow,
                styles.cashMobileHeroRowLast,
                varianceTone === 'ok' && styles.cashHeroOk,
                varianceTone === 'short' && styles.cashHeroShort,
                varianceTone === 'over' && styles.cashHeroOver,
              ]}
            >
              <View style={styles.cashMobileHeroCopy}>
                <Text style={styles.cashMobileHeroLabel}>Variance</Text>
                <Text style={styles.cashMobileHeroMeta}>{drawerLabel}</Text>
              </View>
              <Text
                style={[
                  styles.cashMobileHeroValue,
                  varianceTone === 'ok' && styles.cashIn,
                  varianceTone === 'short' && styles.short,
                  varianceTone === 'over' && styles.over,
                ]}
              >
                {varianceLabel}
              </Text>
            </View>
          </View>
          {trail}
        </View>
      );
    }

    return (
      <View style={styles.cashHeroBlock}>
        <View style={styles.cashHero}>
          <View style={styles.cashHeroCard}>
            <Text style={styles.cashHeroLabel}>Expected</Text>
            <Text style={styles.cashHeroValue} numberOfLines={1}>
              {money(expectedOnHand)}
            </Text>
            <Text style={styles.cashHeroMeta} numberOfLines={1}>
              {posPhysical > 0 ? `POS ${money(posPhysical)}` : 'POS not counted'}
            </Text>
          </View>
          <View style={styles.cashHeroCard}>
            <Text style={styles.cashHeroLabel}>Counted</Text>
            <Text style={styles.cashHeroValue} numberOfLines={1}>
              {hasCount ? money(cashOnHand) : '—'}
            </Text>
            <Text style={styles.cashHeroMeta} numberOfLines={1}>
              {hasCount
                ? activeCountedManual
                  ? 'Manual total'
                  : 'From worksheet'
                : 'Enter loose / stacks'}
            </Text>
          </View>
          <View
            style={[
              styles.cashHeroCard,
              varianceTone === 'ok' && styles.cashHeroOk,
              varianceTone === 'short' && styles.cashHeroShort,
              varianceTone === 'over' && styles.cashHeroOver,
            ]}
          >
            <Text style={styles.cashHeroLabel}>Variance</Text>
            <Text
              style={[
                styles.cashHeroValue,
                varianceTone === 'ok' && styles.cashIn,
                varianceTone === 'short' && styles.short,
                varianceTone === 'over' && styles.over,
              ]}
              numberOfLines={1}
            >
              {varianceLabel}
            </Text>
            <Text style={styles.cashHeroMeta} numberOfLines={1}>
              {drawerLabel}
            </Text>
          </View>
        </View>
        {trail}
      </View>
    );
  };

  const renderCountHeader = () => (
    <View style={styles.cashCountHeader}>
      <Text style={[styles.cashCountH, styles.cashDenomMeta]}>Denom</Text>
      <Text style={[styles.cashCountH, styles.cashCountInputCol]}>Loose</Text>
      <Text style={[styles.cashCountH, styles.cashCountInputCol]}>Stacks</Text>
      <Text style={[styles.cashCountH, styles.cashCountTotalCol]}>Total</Text>
    </View>
  );

  const renderDenomRows = (denoms) =>
    denoms.map((denom) => {
      const col = denomColumnTotals.find((c) => c.key === denom.key);
      const filled =
        String(activeLooseCounts[denom.key] || '').trim() !== '' ||
        String(activeStackCounts[denom.key] || '').trim() !== '';
      return (
        <View
          key={denom.key}
          style={[styles.cashCountRow, filled && styles.cashCountRowFilled]}
        >
          <View style={styles.cashDenomMeta}>
            <Text style={styles.cashDenomTitle}>{denomTitle(denom)}</Text>
            <Text style={styles.cashDenomHint}>{denomHint(denom)}</Text>
          </View>
          <View style={styles.cashCountInputCol}>
            <CashCountInput
              value={activeLooseCounts[denom.key]}
              onChangeText={(value) =>
                setActiveLooseCounts((prev) => ({ ...prev, [denom.key]: value }))
              }
              onSubmitEditing={() => focusNextCashInput(`${denom.key}:loose`)}
              inputRef={registerCashInput(`${denom.key}:loose`)}
              label={`${denomTitle(denom)} loose`}
            />
          </View>
          <View style={styles.cashCountInputCol}>
            <CashCountInput
              value={activeStackCounts[denom.key]}
              onChangeText={(value) =>
                setActiveStackCounts((prev) => ({ ...prev, [denom.key]: value }))
              }
              onSubmitEditing={() => focusNextCashInput(`${denom.key}:stacks`)}
              inputRef={registerCashInput(`${denom.key}:stacks`)}
              label={`${denomTitle(denom)} stacks`}
            />
          </View>
          <Text style={styles.cashCountTotal}>{money(col?.total || 0)}</Text>
        </View>
      );
    });

  const renderMobileDenomRows = (denoms) =>
    denoms.map((denom) => {
      const col = denomColumnTotals.find((c) => c.key === denom.key);
      const filled =
        String(activeLooseCounts[denom.key] || '').trim() !== '' ||
        String(activeStackCounts[denom.key] || '').trim() !== '';
      return (
        <View
          key={denom.key}
          style={[styles.cashMobileDenom, filled && styles.cashMobileDenomFilled]}
        >
          <View style={styles.cashMobileDenomHead}>
            <View style={styles.cashMobileDenomCopy}>
              <Text style={styles.cashMobileDenomTitle}>{denomTitle(denom)}</Text>
              <Text style={styles.cashDenomHint}>{denomHint(denom)}</Text>
            </View>
            <Text style={styles.cashMobileDenomTotal}>{money(col?.total || 0)}</Text>
          </View>
          <View style={styles.cashMobileInputs}>
            <View style={styles.cashMobileField}>
              <Text style={styles.cashMobileFieldLabel}>Loose</Text>
              <CashCountInput
                value={activeLooseCounts[denom.key]}
                onChangeText={(value) =>
                  setActiveLooseCounts((prev) => ({ ...prev, [denom.key]: value }))
                }
                onSubmitEditing={() => focusNextCashInput(`${denom.key}:loose`)}
                inputRef={registerCashInput(`${denom.key}:loose`)}
                label={`${denomTitle(denom)} loose`}
                style={styles.cashCountInputLarge}
              />
            </View>
            <View style={styles.cashMobileField}>
              <Text style={styles.cashMobileFieldLabel}>Stacks</Text>
              <CashCountInput
                value={activeStackCounts[denom.key]}
                onChangeText={(value) =>
                  setActiveStackCounts((prev) => ({ ...prev, [denom.key]: value }))
                }
                onSubmitEditing={() => focusNextCashInput(`${denom.key}:stacks`)}
                inputRef={registerCashInput(`${denom.key}:stacks`)}
                label={`${denomTitle(denom)} stacks`}
                style={styles.cashCountInputLarge}
              />
            </View>
          </View>
        </View>
      );
    });

  const renderMobileMoneyRow = ({ title, hint, value, onChangeText, inputKey, total, strong }) => (
    <View style={[styles.cashMobileDenom, strong && styles.cashMobileDenomFooter]}>
      <View style={styles.cashMobileDenomHead}>
        <View style={styles.cashMobileDenomCopy}>
          <Text style={[styles.cashMobileDenomTitle, strong && styles.statLabelStrong]}>{title}</Text>
          <Text style={styles.cashDenomHint}>{hint}</Text>
        </View>
        <Text style={[styles.cashMobileDenomTotal, strong && styles.statLabelStrong]}>{total}</Text>
      </View>
      <View style={styles.cashMobileMoneyField}>
        <Text style={styles.cashMobileMoneyPrefix}>{isUsdDrawer ? 'US$' : '$'}</Text>
        <CashCountInput
          value={value}
          onChangeText={onChangeText}
          onSubmitEditing={inputKey === 'other' ? () => focusNextCashInput('other') : undefined}
          inputRef={registerCashInput(inputKey)}
          label={title}
          money
          style={styles.cashCountInputPlainLarge}
        />
      </View>
    </View>
  );

  const renderCashCount = () => {
    const { bills, coins } = splitCashDenoms(activeDenoms);
    const split = !isMobile && coins.length > 0;
    const otherRow = isMobile
      ? renderMobileMoneyRow({
          title: 'Other',
          hint: 'Cheques, extras',
          value: activeOtherCashText,
          onChangeText: setActiveOtherCashText,
          inputKey: 'other',
          total: money(otherTotal),
        })
      : (
        <View style={styles.cashCountRow}>
          <View style={styles.cashDenomMeta}>
            <Text style={styles.cashDenomTitle}>Other</Text>
            <Text style={styles.cashDenomHint}>Cheques, extras</Text>
          </View>
          <View style={styles.cashMoneyField}>
            <Text style={styles.cashMoneyPrefix}>{isUsdDrawer ? 'US$' : '$'}</Text>
            <CashCountInput
              value={activeOtherCashText}
              onChangeText={setActiveOtherCashText}
              onSubmitEditing={() => focusNextCashInput('other')}
              inputRef={registerCashInput('other')}
              label="Other cash"
              money
              style={styles.cashCountInputPlain}
            />
          </View>
          <Text style={styles.cashCountTotal}>{money(otherTotal)}</Text>
        </View>
      );
    const countedRow = isMobile
      ? renderMobileMoneyRow({
          title: 'Counted',
          hint: activeCountedManual ? 'Edited total' : 'Sum of worksheet',
          value: activeCountedTotalText,
          onChangeText: (value) => {
            setActiveCountedManual(true);
            setActiveCountedTotalText(value);
          },
          inputKey: 'counted',
          total: hasCount ? money(cashOnHand) : '—',
          strong: true,
        })
      : (
        <View style={[styles.cashCountRow, styles.cashCountFooter]}>
          <View style={styles.cashDenomMeta}>
            <Text style={[styles.cashDenomTitle, styles.statLabelStrong]}>Counted</Text>
            <Text style={styles.cashDenomHint}>
              {activeCountedManual ? 'Edited total' : 'Sum of worksheet'}
            </Text>
          </View>
          <View style={styles.cashMoneyField}>
            <Text style={styles.cashMoneyPrefix}>{isUsdDrawer ? 'US$' : '$'}</Text>
            <CashCountInput
              value={activeCountedTotalText}
              onChangeText={(value) => {
                setActiveCountedManual(true);
                setActiveCountedTotalText(value);
              }}
              inputRef={registerCashInput('counted')}
              label="Counted total"
              money
              style={styles.cashCountInputPlain}
            />
          </View>
          <Text style={[styles.cashCountTotal, styles.statLabelStrong]}>
            {hasCount ? money(cashOnHand) : '—'}
          </Text>
        </View>
      );

    return (
      <GroupSection title={`Count ${drawerLabel}`}>
        <View style={styles.cashCountHintRow}>
          <Text style={styles.cashCountHint}>
            Loose = pieces · stacks = {isUsdDrawer ? '50 bills' : '50 bills or coin rolls'}
          </Text>
        </View>
        {isMobile ? (
          <View style={styles.cashMobileCount}>
            {bills.length ? <Text style={styles.cashMobileGroupTitle}>Bills</Text> : null}
            {renderMobileDenomRows(bills.length ? bills : activeDenoms)}
            {coins.length ? <Text style={styles.cashMobileGroupTitle}>Coins</Text> : null}
            {coins.length ? renderMobileDenomRows(coins) : null}
            {otherRow}
            {countedRow}
          </View>
        ) : split ? (
          <View style={styles.cashCountSplit}>
            <View style={styles.cashCountCol}>
              <Text style={styles.cashCountColTitle}>Bills</Text>
              {renderCountHeader()}
              {renderDenomRows(bills)}
            </View>
            <View style={styles.cashCountCol}>
              <Text style={styles.cashCountColTitle}>Coins</Text>
              {renderCountHeader()}
              {renderDenomRows(coins)}
            </View>
          </View>
        ) : (
          <View>
            {renderCountHeader()}
            {renderDenomRows(activeDenoms)}
          </View>
        )}
        {isMobile ? null : otherRow}
        {isMobile ? null : countedRow}
      </GroupSection>
    );
  };

  const renderCashActivity = () => (
    <View style={styles.cashActivity}>
      <CashFold
        title="Payments"
        detail={
          paymentRows.length
            ? `${paymentRows.length} cleared · ${money(paymentTotals.cashIn)} in · ${money(paymentTotals.cashOut)} out`
            : `No ${drawerLabel} payments today`
        }
        amount={money(paymentTotals.net)}
        amountStyle={paymentTotals.net >= 0 ? styles.cashIn : styles.cashOut}
        open={paymentsOpen}
        onToggle={() => setPaymentsOpen((prev) => !prev)}
        empty={!paymentRows.length}
      >
        {paymentRows.map((row, index) => (
          <CashTxnRow
            key={row.id}
            row={row}
            last={index === paymentRows.length - 1}
          />
        ))}
      </CashFold>
      <CashFold
        title="Till adjustments"
        detail={
          cashTxnRows.length
            ? `${cashTxnRows.length} till ${cashTxnRows.length === 1 ? 'entry' : 'entries'}`
            : `No ${drawerLabel} till entries today`
        }
        amount={money(cashTxnTotals.net)}
        amountStyle={cashTxnTotals.net >= 0 ? styles.cashIn : styles.cashOut}
        open={tillOpen}
        onToggle={() => setTillOpen((prev) => !prev)}
        empty={!cashTxnRows.length}
      >
        {cashTxnRows.map((row, index) => (
          <CashTxnRow
            key={row.id}
            row={row}
            last={index === cashTxnRows.length - 1}
            fallbackLabel={row.category || 'Till'}
          />
        ))}
      </CashFold>
    </View>
  );

  const renderFindWhy = () => (
    <GroupSection title="Find out why">
      <View style={[styles.aiRow, isMobile && styles.aiRowMobile]}>
        <View style={[styles.modelDropdownWrap, isMobile && styles.modelDropdownWrapMobile]}>
          <Pressable
            style={[styles.modelDropdown, modelMenuOpen && styles.modelDropdownOpen]}
            onPress={() => setModelMenuOpen((open) => !open)}
          >
            <View style={styles.modelDropdownMain}>
              <Text style={styles.modelDropdownValue} numberOfLines={1}>
                {modelMeta.label}
              </Text>
              <Text style={styles.modelDropdownMeta} numberOfLines={1}>
                {modelOptionMetaLine(modelMeta)}
              </Text>
            </View>
            <Ionicons
              name={modelMenuOpen ? 'chevron-up' : 'chevron-down'}
              size={16}
              color={SECONDARY}
            />
          </Pressable>
          {modelMenuOpen ? (
            <ScrollView style={styles.modelMenu} nestedScrollEnabled>
              {MODEL_OPTIONS.map((option) => {
                const active = option.key === model;
                return (
                  <Pressable
                    key={option.key}
                    style={[styles.modelOption, active && styles.modelOptionActive]}
                    onPress={() => {
                      setModel(option.key);
                      setModelMenuOpen(false);
                    }}
                  >
                    <View style={styles.modelOptionCopy}>
                      <Text
                        style={[
                          styles.modelOptionText,
                          active && styles.modelOptionTextActive,
                        ]}
                      >
                        {option.label}
                      </Text>
                      <Text style={styles.modelOptionStats}>
                        {modelOptionMetaLine(option)}
                      </Text>
                    </View>
                    {active ? <Ionicons name="checkmark" size={16} color={ACCENT} /> : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          ) : null}
        </View>
        <Pressable
          style={[
            styles.findWhyButton,
            isMobile && styles.findWhyButtonMobile,
            aiBusy && styles.findWhyButtonDisabled,
          ]}
          onPress={runFindOutWhy}
          disabled={aiBusy || !selectedStore}
        >
          {aiBusy && !aiMessages.length ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Ionicons name="sparkles" size={16} color="#fff" />
          )}
          <Text style={styles.findWhyButtonText}>
            {aiBusy && !aiMessages.length ? 'Analyzing…' : 'Find out why'}
          </Text>
        </Pressable>
      </View>
      <View style={styles.aiChatWrap}>{renderAiSection()}</View>
    </GroupSection>
  );

  return (
    <View style={[styles.panelBody, embedded && styles.panelBodyEmbedded, isMobile && styles.panelBodyMobile]}>
      {renderCashToolbar()}

      <View style={styles.metaRow}>
        <Text style={styles.metaText} numberOfLines={1}>
          {loading && !position
            ? 'Loading…'
            : `${selectedStore || 'Store'} · ${
                isToday ? 'Today' : formatPickerDate(date)
              }`}
        </Text>
        {loading && position ? <ActivityIndicator size="small" color={SECONDARY} /> : null}
      </View>

      {error ? <Text style={[styles.errorText, styles.metaError]}>{error}</Text> : null}
      {warning ? <Text style={styles.warningText}>{warning}</Text> : null}

      <ScrollView
        style={styles.appleScroll}
        contentContainerStyle={styles.appleScrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
      >
        {renderCashHero()}
        {renderCashCount()}
        {renderCashActivity()}
        {renderFindWhy()}
      </ScrollView>

      <AuditTxnDrawer
        visible={txnDrawer.visible}
        summary={txnDrawer.summary}
        detail={txnDrawer.detail}
        loading={txnDrawer.loading}
        error={txnDrawer.error}
        onClose={txnDrawer.close}
      />
    </View>
  );
}


export default function AuditScreen({
  session,
  onRequireLogin,
  storeFilter,
  embedded = false,
}) {
  const isMobile = useIsMobile();
  const [activeTab, setActiveTab] = useState('bullion');

  return (
    <View style={[styles.body, embedded && styles.bodyEmbedded, isMobile && styles.panelBodyMobile]}>
      <View style={[styles.tabBar, isMobile && styles.tabBarMobile]}>
        <SegmentedControl
          options={AUDIT_TABS}
          value={activeTab}
          onChange={setActiveTab}
          style={[styles.tabSegment, isMobile && styles.tabSegmentMobile]}
          stretch={isMobile}
        />
      </View>

      {activeTab === 'bullion' ? (
        <BullionAuditPanel
          session={session}
          onRequireLogin={onRequireLogin}
          storeFilter={storeFilter}
          embedded={embedded}
        />
      ) : null}

      {activeTab === 'cash' ? (
        <CashAuditPanel
          session={session}
          onRequireLogin={onRequireLogin}
          storeFilter={storeFilter}
          embedded={embedded}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
    minHeight: 0,
  },
  bodyEmbedded: {
    flex: 1,
    minHeight: 0,
    width: '100%',
    maxWidth: '100%',
  },
  tabBar: {
    flexShrink: 0,
    marginBottom: 10,
    alignItems: 'flex-start',
  },
  tabBarMobile: {
    alignItems: 'stretch',
    marginBottom: 12,
  },
  tabSegment: {
    alignSelf: 'flex-start',
  },
  tabSegmentMobile: {
    alignSelf: 'stretch',
    width: '100%',
  },
  segment: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 0,
    height: 42,
    backgroundColor: FILL,
    borderRadius: 10,
    padding: 2,
  },
  segmentStretch: {
    alignSelf: 'stretch',
    width: '100%',
  },
  segmentButton: {
    paddingHorizontal: 14,
    height: 38,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  segmentButtonStretch: {
    flex: 1,
  },
  segmentButtonActive: {
    backgroundColor: '#fff',
    ...Platform.select({
      web: { boxShadow: '0 1px 2px rgba(0,0,0,0.12)' },
      default: { elevation: 1 },
    }),
  },
  segmentText: {
    fontFamily,
    fontSize: 15,
    fontWeight: '500',
    color: SECONDARY,
    letterSpacing: -0.2,
  },
  segmentTextActive: {
    color: TEXT,
    fontWeight: '600',
  },
  appleToolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 2,
    marginBottom: 8,
    width: '100%',
  },
  appleToolbarMobile: {
    marginTop: 0,
  },
  filterBar: {
    flexGrow: 0,
    flexShrink: 0,
    height: 42,
    maxHeight: 42,
    marginTop: 2,
    marginBottom: 8,
    width: '100%',
    ...Platform.select({
      web: { overflowX: 'auto', overflowY: 'hidden' },
      default: {},
    }),
  },
  filterBarContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 42,
    flexGrow: 1,
  },
  appleSearch: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 140,
    maxWidth: 280,
    borderRadius: 12,
    paddingHorizontal: 12,
    backgroundColor: FILL,
    height: 42,
  },
  appleSearchGrow: {
    flex: 1,
  },
  appleSearchMobile: {
    maxWidth: '100%',
    width: '100%',
    minWidth: 0,
    flexGrow: 0,
    flexShrink: 0,
  },
  mobileToolbar: {
    gap: 8,
    marginTop: 2,
    marginBottom: 8,
    width: '100%',
  },
  mobileToolbarRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    width: '100%',
  },
  storeSelectMobile: {
    maxWidth: '100%',
    width: '100%',
    minWidth: 0,
  },
  storeTitleMobile: {
    maxWidth: '100%',
  },
  fillButtonMobile: {
    width: '100%',
  },
  appleSearchIcon: {
    marginRight: 8,
  },
  appleSearchInput: {
    flex: 1,
    fontFamily,
    fontSize: 16,
    color: TEXT,
    paddingVertical: 0,
    ...Platform.select({
      web: { outlineStyle: 'none' },
      default: {},
    }),
  },
  appleControls: {
    flexDirection: 'row',
    flexWrap: 'nowrap',
    alignItems: 'center',
    gap: 8,
    height: 42,
    marginBottom: 8,
    width: '100%',
  },
  appleControlsMobile: {
    marginBottom: 8,
  },
  appleDateField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: FILL,
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 42,
    justifyContent: 'center',
    flexShrink: 0,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  appleDateValue: {
    fontFamily,
    fontSize: 16,
    color: TEXT,
    letterSpacing: -0.2,
  },
  appleScroll: {
    flex: 1,
    minHeight: 0,
    width: '100%',
  },
  appleScrollContent: {
    paddingBottom: 48,
    paddingTop: 8,
    gap: 20,
  },
  iconToggle: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: FILL,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  iconToggleActive: {
    backgroundColor: '#fff',
    ...Platform.select({
      web: { boxShadow: '0 1px 2px rgba(0,0,0,0.12)' },
      default: { elevation: 1 },
    }),
  },
  fillButton: {
    height: 42,
    minHeight: 42,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: TEXT,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  fillButtonDisabled: {
    opacity: 0.45,
  },
  fillButtonText: {
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
    letterSpacing: -0.2,
  },
  storeTitle: {
    fontFamily,
    fontSize: 16,
    fontWeight: '600',
    color: TEXT,
    letterSpacing: -0.2,
    flexShrink: 1,
    maxWidth: 140,
    lineHeight: 20,
  },
  storeSelect: {
    maxWidth: 160,
    minWidth: 104,
    height: 42,
  },
  drawerSegment: {
    flexShrink: 1,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
    marginBottom: 2,
    minHeight: 18,
  },
  metaText: {
    fontFamily,
    flex: 1,
    fontSize: 13,
    color: SECONDARY,
    letterSpacing: -0.08,
  },
  metaError: {
    marginBottom: 6,
  },
  outlineGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -8,
    rowGap: 16,
  },
  outlineGridList: {
    flexDirection: 'column',
    marginHorizontal: 0,
    rowGap: 16,
  },
  outlineCol: {
    width: '50%',
    paddingHorizontal: 8,
    ...Platform.select({
      web: { boxSizing: 'border-box' },
      default: {},
    }),
  },
  outlineColFull: {
    width: '100%',
    paddingHorizontal: 0,
  },
  groupSection: {
    width: '100%',
    gap: 8,
  },
  groupSectionTitle: {
    fontFamily,
    fontSize: 13,
    fontWeight: '400',
    color: SECONDARY,
    letterSpacing: -0.08,
    paddingHorizontal: 16,
  },
  group: {
    backgroundColor: GROUP_BG,
    borderRadius: 14,
    overflow: 'hidden',
  },
  groupHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 56,
    paddingLeft: 12,
    paddingRight: 10,
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: HAIRLINE,
  },
  groupIcon: {
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  groupHeaderCopy: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  groupTitle: {
    fontFamily,
    fontSize: 17,
    fontWeight: '400',
    color: TEXT,
    letterSpacing: -0.2,
  },
  groupSubtitle: {
    fontFamily,
    fontSize: 13,
    color: SECONDARY,
    letterSpacing: -0.08,
  },
  groupHint: {
    fontFamily,
    flex: 1,
    fontSize: 13,
    color: SECONDARY,
    letterSpacing: -0.08,
    lineHeight: 18,
  },
  rowAction: {
    minHeight: 32,
    minWidth: 32,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: TEXT,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  rowActionDisabled: {
    opacity: 0.45,
  },
  rowActionText: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: '#fff',
  },
  historyRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: HAIRLINE,
  },
  historyCell: {
    minWidth: 36,
    alignItems: 'flex-end',
  },
  historyLabel: {
    fontFamily,
    fontSize: 11,
    color: SECONDARY,
    letterSpacing: -0.08,
  },
  historyValue: {
    fontFamily,
    fontSize: 13,
    color: TEXT,
    fontVariant: ['tabular-nums'],
    letterSpacing: -0.08,
  },
  statRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
    paddingLeft: 16,
    paddingRight: 14,
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: HAIRLINE,
  },
  statRowLast: {
    borderBottomWidth: 0,
  },
  statLabel: {
    fontFamily,
    flex: 1,
    minWidth: 0,
    fontSize: 17,
    fontWeight: '400',
    color: TEXT,
    letterSpacing: -0.2,
  },
  statLabelStrong: {
    fontWeight: '600',
  },
  statMeta: {
    fontFamily,
    fontSize: 13,
    color: SECONDARY,
    letterSpacing: -0.08,
    flexShrink: 1,
  },
  statValue: {
    fontFamily,
    fontSize: 17,
    fontWeight: '400',
    color: TEXT,
    letterSpacing: -0.2,
    fontVariant: ['tabular-nums'],
    textAlign: 'right',
    flexShrink: 0,
  },
  statValueStrong: {
    fontWeight: '600',
  },
  statInput: {
    minWidth: 72,
    maxWidth: 120,
    fontFamily,
    fontSize: 17,
    fontWeight: '400',
    color: TEXT,
    letterSpacing: -0.2,
    fontVariant: ['tabular-nums'],
    textAlign: 'right',
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 8,
    backgroundColor: '#fff',
    ...Platform.select({
      web: { outlineStyle: 'none' },
      default: {},
    }),
  },
  txRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 52,
    paddingLeft: 16,
    paddingRight: 14,
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: HAIRLINE,
  },
  txKind: {
    fontFamily,
    width: 36,
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: -0.2,
    flexShrink: 0,
  },
  txMain: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  txName: {
    fontFamily,
    fontSize: 17,
    fontWeight: '400',
    color: TEXT,
    letterSpacing: -0.2,
  },
  txMeta: {
    fontFamily,
    fontSize: 13,
    color: SECONDARY,
    letterSpacing: -0.08,
  },
  txAmount: {
    fontFamily,
    fontSize: 17,
    fontWeight: '400',
    letterSpacing: -0.2,
    fontVariant: ['tabular-nums'],
    textAlign: 'right',
    flexShrink: 0,
  },
  countHeaderRow: {
    minHeight: 32,
    backgroundColor: '#ebebf0',
  },
  countHeaderLabel: {
    fontFamily,
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    color: SECONDARY,
    letterSpacing: -0.08,
    textAlign: 'center',
  },
  countHeaderTotal: {
    flex: 0,
    minWidth: 72,
    textAlign: 'right',
  },
  denomLabelCol: {
    flex: 0,
    width: 64,
  },
  denomInput: {
    flex: 1,
    minWidth: 56,
    fontFamily,
    fontSize: 17,
    color: TEXT,
    letterSpacing: -0.2,
    fontVariant: ['tabular-nums'],
    textAlign: 'center',
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#fff',
    ...Platform.select({
      web: { outlineStyle: 'none' },
      default: {},
    }),
  },
  denomTotal: {
    fontFamily,
    minWidth: 72,
    fontSize: 15,
    color: TEXT,
    letterSpacing: -0.2,
    fontVariant: ['tabular-nums'],
    textAlign: 'right',
  },
  otherInputWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: 32,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: '#fff',
  },
  otherPrefix: {
    fontFamily,
    fontSize: 17,
    color: SECONDARY,
    letterSpacing: -0.2,
  },
  otherInput: {
    flex: 1,
    minWidth: 0,
    fontFamily,
    fontSize: 17,
    color: TEXT,
    letterSpacing: -0.2,
    fontVariant: ['tabular-nums'],
    paddingVertical: 4,
    ...Platform.select({
      web: { outlineStyle: 'none' },
      default: {},
    }),
  },
  cashHeroBlock: {
    gap: 10,
  },
  cashHero: {
    flexDirection: 'row',
    gap: 8,
  },
  cashHeroMobile: {
    flexWrap: 'wrap',
  },
  cashHeroCard: {
    flex: 1,
    minWidth: 110,
    backgroundColor: GROUP_BG,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 2,
  },
  cashHeroLabel: {
    fontFamily,
    fontSize: 12,
    fontWeight: '600',
    color: SECONDARY,
    letterSpacing: -0.08,
  },
  cashHeroValue: {
    fontFamily,
    fontSize: 20,
    fontWeight: '600',
    color: TEXT,
    letterSpacing: -0.4,
    fontVariant: ['tabular-nums'],
  },
  cashHeroValueMobile: {
    fontSize: 16,
  },
  cashHeroMeta: {
    fontFamily,
    fontSize: 12,
    color: SECONDARY,
    letterSpacing: -0.08,
    marginTop: 2,
  },
  cashHeroOk: {
    backgroundColor: '#E8F5EA',
  },
  cashHeroShort: {
    backgroundColor: '#FDECEA',
  },
  cashHeroOver: {
    backgroundColor: '#E8F1FF',
  },
  cashMobileHeroRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 64,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: HAIRLINE,
  },
  cashMobileHeroRowLast: {
    borderBottomWidth: 0,
  },
  cashMobileHeroCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  cashMobileHeroLabel: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: SECONDARY,
    letterSpacing: -0.08,
  },
  cashMobileHeroMeta: {
    fontFamily,
    fontSize: 13,
    color: SECONDARY,
    letterSpacing: -0.08,
  },
  cashMobileHeroValue: {
    fontFamily,
    fontSize: 22,
    fontWeight: '600',
    color: TEXT,
    letterSpacing: -0.4,
    fontVariant: ['tabular-nums'],
    textAlign: 'right',
    flexShrink: 1,
  },
  cashMobileCount: {
    paddingHorizontal: 12,
    paddingBottom: 8,
    gap: 10,
  },
  cashMobileGroupTitle: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: SECONDARY,
    letterSpacing: -0.08,
    paddingHorizontal: 4,
    paddingTop: 4,
  },
  cashMobileDenom: {
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 10,
  },
  cashMobileDenomFilled: {
    backgroundColor: '#fff',
  },
  cashMobileDenomFooter: {
    backgroundColor: '#ebebf0',
  },
  cashMobileDenomHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  cashMobileDenomCopy: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  cashMobileDenomTitle: {
    fontFamily,
    fontSize: 17,
    fontWeight: '600',
    color: TEXT,
    letterSpacing: -0.3,
  },
  cashMobileDenomTotal: {
    fontFamily,
    fontSize: 17,
    fontWeight: '600',
    color: TEXT,
    letterSpacing: -0.3,
    fontVariant: ['tabular-nums'],
    flexShrink: 0,
  },
  cashMobileInputs: {
    flexDirection: 'row',
    gap: 8,
  },
  cashMobileField: {
    flex: 1,
    minWidth: 0,
    gap: 6,
  },
  cashMobileFieldLabel: {
    fontFamily,
    fontSize: 12,
    fontWeight: '600',
    color: SECONDARY,
    letterSpacing: -0.08,
    paddingLeft: 2,
  },
  cashMobileMoneyField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 48,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: FILL,
  },
  cashMobileMoneyPrefix: {
    fontFamily,
    fontSize: 22,
    fontWeight: '600',
    color: SECONDARY,
    letterSpacing: -0.3,
  },
  cashTrail: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 4,
  },
  cashTrailText: {
    fontFamily,
    fontSize: 13,
    color: SECONDARY,
    letterSpacing: -0.08,
    fontVariant: ['tabular-nums'],
  },
  cashTrailDot: {
    fontFamily,
    fontSize: 13,
    color: CHEVRON,
  },
  cashCountHintRow: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 4,
  },
  cashCountSplit: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  cashCountCol: {
    flex: 1,
    minWidth: 0,
  },
  cashCountColTitle: {
    fontFamily,
    fontSize: 12,
    fontWeight: '600',
    color: SECONDARY,
    letterSpacing: -0.08,
    paddingHorizontal: 16,
    paddingTop: 6,
  },
  cashCountHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 28,
    paddingLeft: 16,
    paddingRight: 14,
    gap: 8,
    backgroundColor: '#ebebf0',
  },
  cashCountRowFilled: {
    backgroundColor: 'rgba(255,255,255,0.55)',
  },
  cashCountFooter: {
    borderBottomWidth: 0,
    backgroundColor: '#ebebf0',
  },
  cashDenomMeta: {
    width: 78,
    flexShrink: 0,
  },
  cashDenomTitle: {
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: TEXT,
    letterSpacing: -0.2,
  },
  cashDenomHint: {
    fontFamily,
    fontSize: 11,
    color: SECONDARY,
    letterSpacing: -0.08,
  },
  cashCountInputCol: {
    flex: 1,
    minWidth: 56,
  },
  cashCountInputPlain: {
    backgroundColor: 'transparent',
    textAlign: 'left',
    minHeight: 28,
    paddingVertical: 0,
  },
  cashCountInputPlainLarge: {
    backgroundColor: 'transparent',
    textAlign: 'left',
    minHeight: 44,
    fontSize: 22,
    paddingVertical: 0,
  },
  cashCountInputLarge: {
    minHeight: 48,
    fontSize: 22,
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 10,
    backgroundColor: FILL,
  },
  cashCountInput: {
    width: '100%',
    minHeight: 34,
    borderRadius: 8,
    backgroundColor: '#fff',
    fontFamily,
    fontSize: 16,
    fontWeight: '600',
    color: TEXT,
    letterSpacing: -0.2,
    fontVariant: ['tabular-nums'],
    textAlign: 'center',
    paddingVertical: 6,
    paddingHorizontal: 6,
    ...Platform.select({
      web: { outlineStyle: 'none' },
      default: {},
    }),
  },
  cashCountTotalCol: {
    width: 76,
    textAlign: 'right',
    flexShrink: 0,
  },
  cashCountTotal: {
    fontFamily,
    width: 76,
    fontSize: 14,
    fontWeight: '600',
    color: TEXT,
    letterSpacing: -0.08,
    fontVariant: ['tabular-nums'],
    textAlign: 'right',
    flexShrink: 0,
  },
  cashMoneyField: {
    flex: 1,
    minWidth: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: 34,
    paddingHorizontal: 8,
    borderRadius: 8,
    backgroundColor: '#fff',
  },
  cashMoneyPrefix: {
    fontFamily,
    fontSize: 15,
    color: SECONDARY,
    letterSpacing: -0.2,
  },
  cashActivity: {
    gap: 12,
  },
  cashFoldHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 56,
    paddingLeft: 16,
    paddingRight: 14,
    gap: 10,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  cashFoldHeaderOpen: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: HAIRLINE,
  },
  cashFoldCopy: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  cashFoldTitle: {
    fontFamily,
    fontSize: 16,
    fontWeight: '600',
    color: TEXT,
    letterSpacing: -0.2,
  },
  cashFoldDetail: {
    fontFamily,
    fontSize: 12,
    color: SECONDARY,
    letterSpacing: -0.08,
  },
  cashFoldAmount: {
    fontFamily,
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: -0.2,
    fontVariant: ['tabular-nums'],
    flexShrink: 0,
  },
  cashTxnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
    paddingLeft: 16,
    paddingRight: 14,
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: HAIRLINE,
  },
  cashTxnKind: {
    fontFamily,
    width: 32,
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: -0.2,
    flexShrink: 0,
  },
  cashTxnMain: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  cashTxnName: {
    fontFamily,
    fontSize: 15,
    fontWeight: '400',
    color: TEXT,
    letterSpacing: -0.2,
  },
  cashTxnMeta: {
    fontFamily,
    fontSize: 12,
    color: SECONDARY,
    letterSpacing: -0.08,
  },
  cashTxnAmount: {
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: -0.2,
    fontVariant: ['tabular-nums'],
    textAlign: 'right',
    flexShrink: 0,
  },
  unbalanceList: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: HAIRLINE,
  },
  aiChatWrap: {
    paddingHorizontal: 12,
    paddingBottom: 12,
    paddingTop: 8,
  },
  panelBody: {
    flex: 1,
    minHeight: 0,
  },
  panelBodyEmbedded: {
    flex: 1,
    minHeight: 0,
    width: '100%',
  },
  panelBodyMobile: {
    width: '100%',
    maxWidth: '100%',
    overflow: 'hidden',
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 12,
    width: '100%',
  },
  storeFilterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    flex: 1,
    minWidth: 180,
  },
  drawerTabRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 12,
  },
  drawerTabRowMobile: {
    marginBottom: 8,
  },
  storeChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#f3f3f3',
  },
  storeChipActive: {
    backgroundColor: '#E8F5EA',
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
  dateFilters: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  todayChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#f3f3f3',
    minHeight: 34,
    justifyContent: 'center',
  },
  todayChipActive: {
    backgroundColor: '#E8F5EA',
  },
  todayChipText: {
    fontFamily,
    fontSize: 13,
    fontWeight: '500',
    color: '#6b6b6b',
  },
  todayChipTextActive: {
    color: ACCENT,
    fontWeight: '600',
  },
  dateChip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e0e0e0',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: '#fff',
    minHeight: 40,
    justifyContent: 'center',
    gap: 2,
  },
  dateChipLabel: {
    fontFamily,
    fontSize: 10,
    fontWeight: '600',
    color: '#8a8a8a',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  dateChipControl: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dateChipValue: {
    fontFamily,
    fontSize: 13,
    color: '#1a1a1a',
    fontWeight: '500',
  },
  dateModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.28)',
    justifyContent: 'flex-end',
  },
  dateModalCard: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingBottom: 24,
  },
  dateModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 4,
  },
  dateModalTitle: {
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  dateModalDone: {
    fontFamily,
    fontSize: 17,
    fontWeight: '600',
    color: '#007AFF',
  },
  refresh: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  refreshButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#E8F5EA',
    minHeight: 34,
    flexShrink: 0,
  },
  refreshButtonDisabled: {
    opacity: 0.7,
  },
  refreshButtonText: {
    fontFamily,
    fontSize: 13,
    fontWeight: '700',
    color: ACCENT,
  },
  storeToolbarTitle: {
    fontFamily,
    fontSize: 14,
    fontWeight: '700',
    color: '#1a1a1a',
    marginRight: 4,
    flexShrink: 1,
  },
  errorBanner: {
    marginBottom: 10,
  },
  errorText: {
    fontFamily,
    fontSize: 13,
    color: '#B91C1C',
    letterSpacing: -0.08,
  },
  warningText: {
    fontFamily,
    fontSize: 12,
    color: '#9a6b2f',
    marginBottom: 8,
  },
  hint: {
    fontFamily,
    fontSize: 14,
    color: '#6b6b6b',
  },
  link: {
    color: ACCENT,
    fontWeight: '600',
  },
  list: {
    flex: 1,
  },
  listEmbedded: {
    flex: 1,
    minHeight: 0,
    width: '100%',
    maxWidth: '100%',
  },
  listContent: {
    paddingBottom: 24,
  },
  section: {
    gap: 14,
  },
  sectionHeader: {
    gap: 2,
  },
  sectionTitle: {
    fontFamily,
    fontSize: 18,
    fontWeight: '700',
    color: '#1a1a1a',
  },
  sectionMeta: {
    fontFamily,
    fontSize: 12,
    color: '#8a8a8a',
  },
  summaryCards: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  summaryCard: {
    flexGrow: 1,
    flexBasis: 120,
    minWidth: 110,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: '#F7FAF7',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#E3EDE4',
  },
  summaryLabel: {
    fontFamily,
    fontSize: 11,
    fontWeight: '600',
    color: '#8a8a8a',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 4,
  },
  summaryValue: {
    fontFamily,
    fontSize: 18,
    fontWeight: '700',
    color: '#1a1a1a',
    fontVariant: ['tabular-nums'],
  },
  summaryHint: {
    fontFamily,
    fontSize: 12,
    color: '#8a8a8a',
    marginTop: 2,
  },
  cashIn: {
    color: '#2F8A4E',
  },
  cashOut: {
    color: '#B45309',
  },
  over: {
    color: '#1D4ED8',
  },
  short: {
    color: '#B91C1C',
  },
  tableBlock: {
    marginTop: 4,
  },
  tableBlockTitle: {
    fontFamily,
    fontSize: 12,
    fontWeight: '600',
    color: '#8a8a8a',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    minHeight: 36,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f0f0f0',
  },
  headerRow: {
    borderBottomColor: '#e5e5e5',
    marginBottom: 2,
    minHeight: 28,
  },
  headerText: {
    fontFamily,
    fontSize: 11,
    fontWeight: '600',
    color: '#9a9a9a',
    letterSpacing: 0.2,
    paddingRight: 8,
  },
  headerTextRight: {
    textAlign: 'right',
  },
  cell: {
    fontFamily,
    fontSize: 13,
    color: '#1a1a1a',
    paddingRight: 8,
  },
  colType: {
    flex: 0.9,
    minWidth: 0,
  },
  colAmount: {
    flex: 0.9,
    minWidth: 0,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  colCustomer: {
    flex: 1.2,
    minWidth: 0,
  },
  colRef: {
    flex: 0.9,
    minWidth: 0,
  },
  colNotes: {
    flex: 1.2,
    minWidth: 0,
    color: '#6b6b6b',
  },
  colNotesWide: {
    flex: 2.1,
    minWidth: 0,
    color: '#6b6b6b',
  },
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 24,
  },
  centeredEmbedded: {
    minHeight: 80,
  },
  emptyText: {
    fontFamily,
    fontSize: 15,
    color: SECONDARY,
    paddingTop: 48,
    paddingBottom: 8,
    textAlign: 'center',
    letterSpacing: -0.08,
  },
  reconcileBlock: {
    marginTop: 8,
    gap: 12,
    paddingTop: 4,
  },
  cashCountHint: {
    fontFamily,
    fontSize: 12,
    color: '#8a8a8a',
    marginTop: -4,
    marginBottom: 2,
    lineHeight: 16,
  },
  cashCountScroll: {
    maxWidth: '100%',
  },
  cashCountScrollContent: {
    paddingBottom: 4,
  },
  cashCountTable: {
    minWidth: 720,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e5e5',
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: '#fff',
  },
  cashCountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 40,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f0f0f0',
    paddingHorizontal: 6,
  },
  cashCountHeaderRow: {
    backgroundColor: '#F7FAF7',
    minHeight: 32,
    borderBottomColor: '#e5e5e5',
  },
  cashCountTotalRow: {
    backgroundColor: '#FAFAFA',
    borderBottomWidth: 0,
    minHeight: 36,
  },
  cashCountH: {
    fontFamily,
    fontSize: 11,
    fontWeight: '700',
    color: '#6b6b6b',
    textAlign: 'center',
    letterSpacing: 0.2,
  },
  cashCountLabelCol: {
    width: 64,
    paddingHorizontal: 6,
  },
  cashCountDenomCol: {
    width: 68,
    paddingHorizontal: 3,
  },
  cashCountOtherCol: {
    width: 96,
    paddingHorizontal: 3,
  },
  cashCountLabel: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  legacyCashCountInput: {
    fontFamily,
    fontSize: 14,
    fontWeight: '600',
    color: '#1a1a1a',
    textAlign: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e0e0e0',
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 4,
    backgroundColor: '#fff',
    fontVariant: ['tabular-nums'],
    ...Platform.select({
      web: { outlineStyle: 'none' },
      default: {},
    }),
  },
  cashCountOtherWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e0e0e0',
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 6,
    backgroundColor: '#fff',
  },
  cashCountOtherPrefix: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: '#8a8a8a',
  },
  cashCountOtherInput: {
    flex: 1,
    minWidth: 0,
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: '#1a1a1a',
    paddingVertical: 0,
    fontVariant: ['tabular-nums'],
    ...Platform.select({
      web: { outlineStyle: 'none' },
      default: {},
    }),
  },
  cashCountDash: {
    fontFamily,
    fontSize: 14,
    color: '#bbb',
    textAlign: 'center',
  },
  cashCountTotalLabel: {
    fontFamily,
    fontSize: 12,
    fontWeight: '700',
    color: '#6b6b6b',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  cashCountTotalCell: {
    fontFamily,
    fontSize: 11,
    fontWeight: '700',
    color: '#1a1a1a',
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  reconcileRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    alignItems: 'stretch',
  },
  countedTotalBox: {
    minWidth: 140,
    flexGrow: 1,
    flexBasis: 160,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#fff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e0e0e0',
    justifyContent: 'center',
  },
  countedTotalValue: {
    fontFamily,
    fontSize: 18,
    fontWeight: '700',
    color: '#1a1a1a',
    fontVariant: ['tabular-nums'],
  },
  countedTotalInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
    gap: 2,
  },
  countedTotalPrefix: {
    fontFamily,
    fontSize: 18,
    fontWeight: '700',
    color: '#1a1a1a',
  },
  countedTotalInput: {
    flex: 1,
    minWidth: 0,
    fontFamily,
    fontSize: 18,
    fontWeight: '700',
    color: '#1a1a1a',
    fontVariant: ['tabular-nums'],
    paddingVertical: Platform.OS === 'web' ? 2 : 0,
    paddingHorizontal: 0,
    margin: 0,
    borderWidth: 0,
    outlineStyle: 'none',
  },
  countedTotalHint: {
    fontFamily,
    fontSize: 10,
    color: '#9a9a9a',
    marginTop: 4,
  },
  varianceBox: {
    minWidth: 140,
    flexGrow: 1,
    flexBasis: 140,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#F7FAF7',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#E3EDE4',
    justifyContent: 'center',
  },
  varianceLabel: {
    fontFamily,
    fontSize: 11,
    fontWeight: '600',
    color: '#8a8a8a',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 2,
  },
  varianceValue: {
    fontFamily,
    fontSize: 16,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  varianceMuted: {
    fontFamily,
    fontSize: 14,
    color: '#8a8a8a',
  },
  aiRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    alignItems: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  modelDropdownWrap: {
    flex: 1,
    minWidth: 220,
    position: 'relative',
    zIndex: 2,
  },
  modelDropdown: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: FILL,
    minHeight: 48,
  },
  modelDropdownOpen: {
    backgroundColor: '#fff',
  },
  modelDropdownMain: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  modelDropdownValue: {
    fontFamily,
    fontSize: 14,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  modelDropdownMeta: {
    fontFamily,
    fontSize: 11,
    color: '#8a8a8a',
  },
  modelMenu: {
    marginTop: 6,
    maxHeight: 260,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e0e0e0',
    borderRadius: 10,
    backgroundColor: '#fff',
    ...Platform.select({
      web: { boxShadow: '0 8px 24px rgba(0,0,0,0.08)' },
      default: {
        shadowColor: '#000',
        shadowOpacity: 0.08,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 4 },
        elevation: 3,
      },
    }),
  },
  modelOption: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f0f0f0',
  },
  modelOptionActive: {
    backgroundColor: '#F0F8EE',
  },
  modelOptionCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  modelOptionText: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  modelOptionTextActive: {
    color: ACCENT,
  },
  modelOptionStats: {
    fontFamily,
    fontSize: 11,
    color: '#8a8a8a',
  },
  modelOptionBlurb: {
    fontFamily,
    fontSize: 11,
    color: '#6b6b6b',
  },
  findWhyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: TEXT,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    minHeight: 48,
    minWidth: 140,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  findWhyButtonDisabled: {
    opacity: 0.45,
  },
  findWhyButtonText: {
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
    letterSpacing: -0.2,
  },
  aiProgress: {
    fontFamily,
    fontSize: 13,
    color: SECONDARY,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  aiResult: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#E3EDE4',
    borderRadius: 12,
    backgroundColor: '#F7FAF7',
    padding: 14,
  },
  aiResultText: {
    fontFamily,
    fontSize: 13,
    lineHeight: 20,
    color: '#1a1a1a',
  },
  aiChat: {
    gap: 10,
  },
  aiChatBubble: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 12,
    gap: 4,
  },
  aiChatBubbleAssistant: {
    borderColor: HAIRLINE,
    backgroundColor: '#fff',
  },
  aiChatBubbleUser: {
    borderColor: HAIRLINE,
    backgroundColor: '#fff',
    alignSelf: 'flex-end',
    maxWidth: '92%',
  },
  aiChatRole: {
    fontFamily,
    fontSize: 11,
    fontWeight: '600',
    color: SECONDARY,
    letterSpacing: -0.08,
  },
  aiChatRoleUser: {
    color: TEXT,
  },
  aiChatUserText: {
    color: '#1a1a1a',
  },
  aiChatComposer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
  },
  aiChatInput: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily,
    fontSize: 16,
    color: TEXT,
    backgroundColor: '#fff',
  },
  aiChatSend: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: TEXT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  aiChatSendDisabled: {
    opacity: 0.5,
  },
  bullionFilterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
    flexWrap: 'wrap',
    flexShrink: 0,
  },
  searchWrap: {
    flex: 1,
    minWidth: 160,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e0e0e0',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: '#fff',
    minHeight: 34,
  },
  searchInput: {
    flex: 1,
    fontFamily,
    fontSize: 13,
    color: '#1a1a1a',
    paddingVertical: 0,
    ...Platform.select({
      web: { outlineStyle: 'none' },
      default: {},
    }),
  },
  bullionTableCard: {
    backgroundColor: GROUP_BG,
    borderRadius: 14,
    overflow: 'hidden',
    width: '100%',
  },
  bullionTableScroll: {
    width: '100%',
  },
  bullionTableScrollContent: {
    flexGrow: 1,
  },
  bullionTable: {
    flexGrow: 1,
    minWidth: 920,
  },
  bullionListContent: {
    paddingBottom: 24,
  },
  bullionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 34,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: HAIRLINE,
    paddingRight: 8,
    gap: 4,
  },
  bullionRowStriped: {
    backgroundColor: 'rgba(255,255,255,0.45)',
  },
  bullionRowOff: {
    backgroundColor: 'rgba(255,59,48,0.08)',
  },
  bullionHeaderRow: {
    backgroundColor: '#ebebf0',
    borderBottomColor: HAIRLINE,
    minHeight: 30,
    paddingVertical: 4,
    flexShrink: 0,
    ...Platform.select({
      web: { position: 'sticky', top: 0, zIndex: 3 },
      default: {},
    }),
  },
  bullionH: {
    fontFamily,
    fontSize: 11,
    fontWeight: '600',
    color: SECONDARY,
    letterSpacing: -0.08,
  },
  bullionHFill: {
    color: TEXT,
  },
  bullionMetalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 26,
    paddingLeft: 10,
    paddingRight: 8,
    backgroundColor: '#ebebf0',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: HAIRLINE,
  },
  bullionMetalDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  bullionMetalTitle: {
    fontFamily,
    fontSize: 12,
    fontWeight: '600',
    color: TEXT,
    letterSpacing: -0.08,
  },
  bullionCell: {
    fontFamily,
    fontSize: 13,
    color: TEXT,
    fontVariant: ['tabular-nums'],
    letterSpacing: -0.08,
  },
  bAccent: {
    width: 3,
    alignSelf: 'stretch',
    borderRadius: 1,
    marginVertical: 6,
    marginLeft: 6,
    flexShrink: 0,
  },
  bColMetal: {
    width: 56,
    color: SECONDARY,
  },
  bColItem: {
    flex: 1,
    minWidth: 188,
    maxWidth: 340,
    paddingRight: 8,
  },
  bItemCell: {
    justifyContent: 'center',
    minWidth: 0,
  },
  bItemName: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: TEXT,
    letterSpacing: -0.08,
  },
  bItemSku: {
    fontFamily,
    fontSize: 11,
    color: SECONDARY,
    marginTop: 0,
    letterSpacing: -0.08,
  },
  bColHist: {
    width: BULLION_HIST_COL_WIDTH,
    textAlign: 'right',
    flexShrink: 0,
  },
  bHistCell: {
    color: SECONDARY,
  },
  bColNum: {
    width: 52,
    textAlign: 'right',
    flexShrink: 0,
  },
  bSystemCell: {
    fontWeight: '700',
  },
  bTotalCell: {
    fontWeight: '600',
  },
  bColInput: {
    width: 64,
    flexShrink: 0,
    textAlign: 'center',
  },
  bInput: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#d8d8de',
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 4,
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: TEXT,
    backgroundColor: '#fff',
    fontVariant: ['tabular-nums'],
    textAlign: 'right',
    minHeight: 34,
    ...Platform.select({
      web: { outlineStyle: 'none' },
      default: {},
    }),
  },
  bInputDense: {
    minHeight: 28,
    fontSize: 13,
    paddingVertical: 3,
    borderRadius: 6,
  },
  bInputLarge: {
    minHeight: 48,
    fontSize: 22,
    fontWeight: '600',
    textAlign: 'center',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderWidth: 0,
  },
  bMobileStack: {
    gap: 12,
    width: '100%',
  },
  bMobileSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 4,
    paddingTop: 8,
  },
  bMobileSectionTitle: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: SECONDARY,
    letterSpacing: -0.08,
    textTransform: 'uppercase',
  },
  bMobileCard: {
    backgroundColor: GROUP_BG,
    borderRadius: 14,
    overflow: 'hidden',
    flexDirection: 'row',
    width: '100%',
  },
  bMobileCardOff: {
    backgroundColor: '#FDECEA',
  },
  bMobileAccent: {
    width: 4,
    alignSelf: 'stretch',
  },
  bMobileInner: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 12,
    gap: 12,
  },
  bMobileHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  bMobileTitleWrap: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  bMobileName: {
    fontFamily,
    fontSize: 17,
    fontWeight: '600',
    color: TEXT,
    letterSpacing: -0.3,
  },
  bMobileSku: {
    fontFamily,
    fontSize: 13,
    color: SECONDARY,
    letterSpacing: -0.08,
  },
  bMobileUpdate: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: TEXT,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  bMobileStats: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 4,
  },
  bMobileStat: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
    minWidth: 0,
  },
  bMobileStatDivider: {
    width: StyleSheet.hairlineWidth,
    alignSelf: 'stretch',
    backgroundColor: HAIRLINE,
  },
  bMobileStatLabel: {
    fontFamily,
    fontSize: 12,
    fontWeight: '600',
    color: SECONDARY,
    letterSpacing: -0.08,
  },
  bMobileStatValue: {
    fontFamily,
    fontSize: 22,
    fontWeight: '600',
    color: TEXT,
    letterSpacing: -0.4,
    fontVariant: ['tabular-nums'],
  },
  bMobileHistory: {
    flexDirection: 'row',
    alignItems: 'stretch',
    width: '100%',
  },
  bMobileHistCell: {
    flex: 1,
    alignItems: 'center',
    minWidth: 0,
    gap: 2,
  },
  bMobileHistLabel: {
    fontFamily,
    fontSize: 11,
    fontWeight: '600',
    color: SECONDARY,
    letterSpacing: -0.08,
  },
  bMobileHistValue: {
    fontFamily,
    fontSize: 13,
    color: TEXT,
    fontVariant: ['tabular-nums'],
    letterSpacing: -0.08,
  },
  bMobileFields: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -4,
  },
  bMobileField: {
    width: '50%',
    paddingHorizontal: 4,
    paddingBottom: 8,
    gap: 6,
    minWidth: 0,
    ...Platform.select({
      web: { boxSizing: 'border-box' },
      default: {},
    }),
  },
  bMobileFieldLabel: {
    fontFamily,
    fontSize: 12,
    fontWeight: '600',
    color: SECONDARY,
    letterSpacing: -0.08,
    paddingLeft: 2,
  },
  bColDiff: {
    width: 52,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  bColAction: {
    width: 36,
    alignItems: 'flex-end',
    flexShrink: 0,
  },
  bUpdateButton: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: TEXT,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  diffMuted: {
    fontFamily,
    fontSize: 12,
    color: '#ccc',
    fontWeight: '600',
  },
  diffMutedCompact: {
    fontSize: 11,
  },
  diffBadge: {
    minWidth: 40,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    alignItems: 'center',
    backgroundColor: FILL,
  },
  diffBadgeCompact: {
    minWidth: 32,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 6,
  },
  diffBadgeOk: {
    backgroundColor: FILL,
  },
  diffBadgeShort: {
    backgroundColor: '#FF3B30',
  },
  diffBadgeOver: {
    backgroundColor: '#007AFF',
  },
  diffBadgeText: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
    letterSpacing: -0.08,
  },
  diffBadgeTextCompact: {
    fontSize: 11,
  },
  diffBadgeTextOk: {
    color: TEXT,
  },
  diffBadgeTextShort: {
    color: '#fff',
  },
  diffBadgeTextOver: {
    color: '#fff',
  },
  updateButton: {
    backgroundColor: '#4A90D9',
    borderRadius: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    minWidth: 64,
    minHeight: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  updateButtonDisabled: {
    opacity: 0.7,
  },
  updateButtonText: {
    fontFamily,
    fontSize: 12,
    fontWeight: '700',
    color: '#fff',
  },
  updateAllButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#4A90D9',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minHeight: 34,
    flexShrink: 0,
  },
  updateAllButtonDisabled: {
    opacity: 0.55,
  },
  updateAllButtonText: {
    fontFamily,
    fontSize: 13,
    fontWeight: '700',
    color: '#fff',
  },
  bullionAiBlock: {
    flexShrink: 0,
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e5e5e5',
    maxHeight: '42%',
  },
  bullionAiScroll: {
    flexGrow: 0,
  },
  bullionAiScrollContent: {
    gap: 10,
    paddingBottom: 8,
  },
  bullionAiHeader: {
    gap: 2,
  },
  unbalancedChipRow: {
    gap: 6,
    paddingVertical: 2,
  },
  unbalancedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#F7F7F7',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e8e8e8',
    maxWidth: 220,
  },
  unbalancedChipName: {
    fontFamily,
    fontSize: 12,
    fontWeight: '600',
    color: '#1a1a1a',
    flexShrink: 1,
  },
  unbalancedChipDiff: {
    fontFamily,
    fontSize: 12,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  filterSelect: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 42,
    minHeight: 42,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: FILL,
    maxWidth: 160,
    flexShrink: 1,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  filterSelectLocked: {
    opacity: 0.9,
  },
  filterSelectDisabled: {
    opacity: 0.5,
  },
  filterSelectCopy: {
    flex: 1,
    minWidth: 0,
  },
  filterSelectLabel: {
    fontFamily,
    fontSize: 9,
    fontWeight: '600',
    color: '#8a8a8a',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    lineHeight: 11,
  },
  filterSelectValue: {
    fontFamily,
    fontSize: 16,
    fontWeight: '400',
    color: TEXT,
    letterSpacing: -0.2,
  },
  filterModalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  filterModalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.28)',
  },
  filterModalSheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: '70%',
    paddingBottom: Platform.OS === 'ios' ? 28 : 16,
  },
  filterModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  filterModalTitle: {
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  filterModalList: {
    maxHeight: 360,
  },
  filterModalOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#f0f0f0',
  },
  filterModalOptionActive: {
    backgroundColor: FILL,
  },
  filterModalOptionText: {
    fontFamily,
    fontSize: 17,
    color: TEXT,
    flex: 1,
    letterSpacing: -0.2,
  },
  filterModalOptionTextActive: {
    fontWeight: '600',
    color: TEXT,
  },
  compactDateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: 34,
    paddingHorizontal: 8,
    borderRadius: 8,
    backgroundColor: '#f3f3f3',
    flexShrink: 0,
  },
  compactDateValue: {
    fontFamily,
    fontSize: 12,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  aiRowMobile: {
    flexDirection: 'column',
    alignItems: 'stretch',
  },
  modelDropdownWrapMobile: {
    width: '100%',
    minWidth: 0,
    flex: 0,
  },
  findWhyButtonMobile: {
    width: '100%',
    justifyContent: 'center',
  },
});
