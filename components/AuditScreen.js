import { createElement, Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
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
import Ionicons from '@expo/vector-icons/Ionicons';
import { useAppAccess } from '../lib/permissions';
import {
  countedPhysicalTotal,
  fetchBullionAudit,
  fetchBullionAuditStores,
  formatQty,
  formatWeekColumnLabel,
  saveInventoryLog,
} from '../lib/bullionAudit';
import {
  saveAfternoonCount,
  saveLocalBullionCounts,
  saveNightCount,
} from '../lib/bullionNight';
import { buildUnbalancedBullionItems } from '../lib/bullionAuditAi';
import {
  analyzeBullionRange,
  analyzeCashRange,
  continueRangeChat,
  formatRangeLabel,
  MAX_RANGE_DAYS,
  normalizeAuditRange,
} from '../lib/auditRangeAi';
import { useAuditRangeChat } from '../lib/useAuditRangeChat';
import {
  AUDIT_CASH_STORES,
  fetchStoreCashPosition,
  formatAmount,
  QUEBEC_STORES,
  shiftDateParam,
} from '../lib/cashTill';
import {
  CASH_DENOMS,
  USD_DENOMS,
  addPieceMaps,
  bumpCountText,
  computeCountedFromDenoms,
  countedPiecesForDenom,
  denomHint,
  denomPieceLabel,
  denomStackLabel,
  denomTitle,
  emptyDenomCounts,
  looseBreakdownLine,
  pieceBreakdownLine,
  piecesFromSheet,
  splitCashDenoms,
} from '../lib/cashDenoms';
import { hasSheetValues, loadStoreCashCounts, saveStoreCashCount } from '../lib/cashCounts';
import {
  loadStoreDayTxnCashBreakdowns,
  sumBreakdownPieces,
  useTxnCashBreakdowns,
} from '../lib/txnCashBreakdowns';
import TxnCashBreakdownModal, { TxnCashIcon } from './TxnCashBreakdownModal';
import { storesMatch } from '../lib/storeCatalog';
import {
  formatDateParam,
  formatPickerDate,
  normalizeHomeStoreName,
  parseDateParam,
} from '../lib/transactions';
import {
  formatModelReleased,
  getModelMeta,
  OPENROUTER_MODELS,
} from '../lib/openrouter';
import { mobileSafeBottom, NAV_TAB_ACTIVE_RADIUS, useIsMobile } from '../lib/mobileUi';
import { FONT_LIGHT } from '../lib/typography';
import { AUREUS_CASH_LIVE_MS, useLiveRefresh } from '../lib/liveRefresh';
import { AuditAiChat, AuditTxnDrawer, useAuditTxnDrawer } from './AuditAiOutput';
import ItemAuditPanel from './ItemAuditPanel';
import { BarButton, IconAction, SearchField, T } from './TriageKit';

const fontFamily = Platform.select({
  ios: 'Sohne',
  android: 'Sohne',
  default: 'Sohne',
});

const ACCENT = '#1F8A4E';
const TINT = '#EAF6EE';
const BLUE = T.blue;
const GREEN = ACCENT;
const TEXT = T.text;
const SECONDARY = T.secondary;
const FILL = T.fillSoft;
const PAGE = T.bg;
const CARD = T.card;
const HAIRLINE = '#e5e5ea';
const CHEVRON = T.tertiary;
const RED = T.red;
const ORANGE = T.orange;
const AUDIT_TABS = [
  { key: 'bullion', label: 'Bullion' },
  { key: 'cash', label: 'Cash' },
  { key: 'item', label: 'Audit by Item', shortLabel: 'Item' },
];
const CHIP_SHADOW = Platform.select({
  web: { boxShadow: '0 1px 2px rgba(0,0,0,0.05)' },
  default: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 2,
    elevation: 1,
  },
});
const TICKET_SHADOW = CHIP_SHADOW;
const TAB_BORDER = '#d0d0d0';
const HEAD_RULE = 'rgba(42,38,30,0.16)';
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

function sameJson(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return false;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

function namesMatch(a, b) {
  return storesMatch(a, b);
}

function findBullionStore(stores, name) {
  if (!name || !stores?.length) return null;
  const target = String(name).trim();
  const exact = stores.find((store) => namesMatch(store.name, target));
  if (exact) return exact;

  const pinned = normalizeHomeStoreName(target);
  if (pinned) {
    const match = stores.find((store) => namesMatch(store.name, pinned));
    if (match) return match;
  }

  const lower = target.toLowerCase();
  const fuzzy = stores.filter((store) => {
    const value = String(store.name || '').trim().toLowerCase();
    return value.includes(lower) || lower.includes(value);
  });
  if (fuzzy.length === 1) return fuzzy[0];
  if (fuzzy.length > 1) {
    return (
      fuzzy.find((store) => store.systemKey === 'gta' || store.systemKey === 'pmx') || fuzzy[0]
    );
  }
  return null;
}

function resolveCashStoreName(name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return null;
  const exact = AUDIT_CASH_STORES.find((store) => namesMatch(store, trimmed));
  if (exact) return exact;
  return normalizeHomeStoreName(trimmed) || trimmed;
}

function TicketFieldRow({ label, last, children }) {
  return (
    <View style={[styles.ticketFieldRow, last && styles.ticketFieldRowLast]}>
      <Text style={styles.ticketFieldLabel}>{label}</Text>
      <View style={styles.ticketFieldControl}>{children}</View>
    </View>
  );
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
  disabled = false,
  style,
  showLabel = false,
  variant = 'chip',
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((opt) => opt.value === value);
  const plain = variant === 'plain';

  return (
    <>
      <Pressable
        style={[
          plain ? styles.filterSelectPlain : styles.filterSelect,
          disabled && styles.filterSelectDisabled,
          style,
        ]}
        onPress={() => {
          if (!disabled) setOpen(true);
        }}
        disabled={disabled}
      >
        <View style={styles.filterSelectCopy}>
          {showLabel && label && !plain ? <Text style={styles.filterSelectLabel}>{label}</Text> : null}
          <Text
            style={[styles.filterSelectValue, plain && styles.filterSelectValuePlain]}
            numberOfLines={1}
          >
            {selected?.label || label || 'Select'}
          </Text>
        </View>
        <Ionicons name="chevron-down" size={14} color={plain ? CHEVRON : SECONDARY} />
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
                    {active ? <Ionicons name="checkmark" size={20} color={ACCENT} /> : null}
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
  return { vault: '', night: '', afternoon: '', store: '', other: '' };
}

function countedTotalFromDraft(draft) {
  return countedPhysicalTotal(
    parseQtyInput(draft?.vault),
    parseQtyInput(draft?.night),
    parseQtyInput(draft?.afternoon),
  );
}

const QTY_FIELDS = ['vault', 'night', 'afternoon', 'store', 'other'];
const SHIFT_FIELDS = ['night', 'afternoon'];
const QTY_HEADER_LABELS = {
  vault: 'Vault',
  night: 'Night',
  afternoon: 'Afternoon',
  store: 'Store',
  other: 'Other',
};
const BULLION_TABLE_MIN_WIDTH = 1160;
const BULLION_GRID = '4px 260px 72px repeat(5, 104px) 88px 84px';

function HistoryStrip({ historyDates, history, variant = 'inline' }) {
  if (!historyDates?.length) return null;
  const card = variant === 'card';
  return (
    <View style={card ? styles.bHistCard : styles.bHistInline} accessibilityLabel="Previous counts">
      {historyDates.map((day, index) => {
        const value = history?.[day];
        return (
          <View
            key={day}
            style={[
              card ? styles.bHistCardCell : styles.bHistInlineCell,
              index === historyDates.length - 1 && styles.bHistCellLast,
            ]}
          >
            <Text style={card ? styles.bHistCardLabel : styles.bHistInlineLabel}>
              {formatWeekColumnLabel(day)}
            </Text>
            <Text
              style={card ? styles.bHistCardValue : styles.bHistInlineValue}
              numberOfLines={1}
            >
              {value == null ? '—' : formatQty(value)}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

function draftShowsDiff(draft, confirmed) {
  return (
    Boolean(confirmed) ||
    QTY_FIELDS.some((field) => String(draft?.[field] || '') !== '')
  );
}

function DateChip({ label, value, onChange, maximumDate, variant = 'chip' }) {
  const [open, setOpen] = useState(false);
  const dateValue = parseDateParam(value);
  const plain = variant === 'plain';

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
      {plain ? null : <Ionicons name="calendar-outline" size={16} color={SECONDARY} />}
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
              fontSize: plain ? 15 : 16,
              color: TEXT,
              padding: 0,
              margin: 0,
              outline: 'none',
              cursor: 'pointer',
              minWidth: plain ? 0 : 118,
              width: plain ? '100%' : undefined,
              textAlign: plain ? 'right' : 'left',
              letterSpacing: -0.2,
            },
          })
        : (
          <Text style={[styles.appleDateValue, plain && styles.ticketFieldValue]}>
            {formatPickerDate(dateValue)}
          </Text>
        )}
      {plain ? <Ionicons name="chevron-down" size={14} color={CHEVRON} /> : null}
    </>
  );

  if (Platform.OS === 'web') {
    return <View style={[plain ? styles.dateChipPlain : styles.appleDateField]}>{field}</View>;
  }

  return (
    <>
      <Pressable style={plain ? styles.dateChipPlain : styles.appleDateField} onPress={() => setOpen(true)}>
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

const RANGE_PRESETS = [7, 14, 30];

/**
 * From/To pickers + "Review range" + its own chat. The chat keeps the saved
 * transcript for the last review so follow-ups stay on that request.
 */
function RangeReviewSection({
  title = 'Review a date range',
  isMobile,
  startDate,
  endDate,
  onChangeRange,
  chat,
  onRun,
  onSend,
  canRun,
  runHint,
  placeholder,
  onOpenReference,
  model,
  onChangeModel,
  modelMenuOpen,
  onToggleModelMenu,
}) {
  const today = new Date();
  const range = normalizeAuditRange(startDate, endDate);
  const reviewing = chat.busy && !chat.hasContext;

  const setStart = (next) => {
    const key = formatDateParam(next);
    onChangeRange(key, key > endDate ? key : endDate);
  };
  const setEnd = (next) => {
    const key = formatDateParam(next);
    onChangeRange(key < startDate ? key : startDate, key);
  };
  const applyPreset = (days) => {
    onChangeRange(shiftDateParam(endDate, -(days - 1)), endDate);
  };

  return (
    <GroupSection title={title}>
      <View style={styles.rangePresetRow}>
        <View style={styles.rangeDatePick}>
          <Text style={styles.rangeDateCaption}>From</Text>
          <DateChip label="From" value={startDate} onChange={setStart} maximumDate={today} />
        </View>
        <View style={styles.rangeDatePick}>
          <Text style={styles.rangeDateCaption}>To</Text>
          <DateChip label="To" value={endDate} onChange={setEnd} maximumDate={today} />
        </View>
        {RANGE_PRESETS.map((days) => {
          const active = shiftDateParam(endDate, -(days - 1)) === startDate;
          return (
            <Pressable
              key={days}
              style={[styles.rangePreset, active && styles.rangePresetActive]}
              onPress={() => applyPreset(days)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
            >
              <Text style={[styles.rangePresetText, active && styles.rangePresetTextActive]}>
                {days} days
              </Text>
            </Pressable>
          );
        })}
        <Text style={styles.rangeHint} numberOfLines={1}>
          {range.days} day{range.days === 1 ? '' : 's'}
          {range.clamped ? ` · capped at ${MAX_RANGE_DAYS}` : ''}
        </Text>
      </View>

      <View style={[styles.aiRow, isMobile && styles.aiRowMobile]}>
        <View style={[styles.modelDropdownWrap, isMobile && styles.modelDropdownWrapMobile]}>
          <Pressable
            style={[styles.modelDropdown, modelMenuOpen && styles.modelDropdownOpen]}
            onPress={() => onToggleModelMenu((open) => !open)}
          >
            <View style={styles.modelDropdownMain}>
              <Text style={styles.modelDropdownValue} numberOfLines={1}>
                {getModelMeta(model, MODEL_OPTIONS)?.label || model}
              </Text>
              <Text style={styles.modelDropdownMeta} numberOfLines={1}>
                {modelOptionMetaLine(getModelMeta(model, MODEL_OPTIONS) || MODEL_OPTIONS[0])}
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
                      onChangeModel(option.key);
                      onToggleModelMenu(false);
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
                      <Text style={styles.modelOptionStats}>{modelOptionMetaLine(option)}</Text>
                      {option.blurb ? (
                        <Text style={styles.modelOptionBlurb}>{option.blurb}</Text>
                      ) : null}
                    </View>
                    {active ? <Ionicons name="checkmark" size={20} color={ACCENT} /> : null}
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
            (chat.busy || !canRun) && styles.findWhyButtonDisabled,
          ]}
          onPress={onRun}
          disabled={chat.busy || !canRun}
        >
          {reviewing ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Ionicons name="sparkles" size={16} color="#fff" />
          )}
          <Text style={styles.findWhyButtonText}>{reviewing ? 'Reviewing…' : 'Review range'}</Text>
        </Pressable>
      </View>
      {runHint ? (
        <Text style={[styles.rangeDescription, isMobile && styles.rangeDescriptionMobile]}>{runHint}</Text>
      ) : null}

      {chat.label && chat.hasContext ? (
        <Text style={styles.aiProgress}>Reviewed {chat.label}. Follow-ups use this review.</Text>
      ) : null}
      {chat.busy && chat.progress ? <Text style={styles.aiProgress}>{chat.progress}</Text> : null}
      {chat.status === 'error' && chat.error ? (
        <Text style={[styles.errorText, styles.aiProgress]}>{chat.error}</Text>
      ) : null}
      <View style={styles.aiChatWrap}>
        <AuditAiChat
          turns={chat.turns}
          draft={chat.draft}
          onChangeDraft={chat.setDraft}
          onSend={onSend}
          busy={chat.busy}
          disabled={!chat.hasContext}
          placeholder={placeholder}
          onOpenReference={onOpenReference}
        />
      </View>
    </GroupSection>
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

function moneySum(values) {
  return Math.round(values.reduce((sum, value) => sum + (Number(value) || 0), 0) * 100) / 100;
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
  plain,
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
      style={[
        styles.bInput,
        dense && !large && !plain && styles.bInputDense,
        large && !plain && styles.bInputLarge,
        plain && styles.bInputPlain,
      ]}
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
  isSaving,
  savingLocal,
  savingAll,
  showDiff,
  onChangeField,
  onBlurField,
  onSave,
  onUpdate,
  registerQtyInput,
  onSubmitField,
}) {
  const total = countedTotalFromDraft(draft);
  const accent = metalAccent(row.metal);
  const mismatch =
    showDiff && Math.abs(total - (Number(row.systemCount) || 0)) >= 0.0005;
  const busy = isSaving || savingLocal || savingAll;

  return (
    <View style={[styles.bullionRow, mismatch && styles.bullionRowOff]}>
      <View style={[styles.bAccent, { backgroundColor: accent }]} />
      <View style={[styles.bColItem, styles.bItemCell]}>
        <Text style={styles.bItemName} numberOfLines={2}>
          {row.name}
        </Text>
        {row.sku ? (
          <Text style={styles.bItemSku} numberOfLines={1}>
            {row.sku}
          </Text>
        ) : null}
        <HistoryStrip historyDates={historyDates} history={row.history} />
      </View>
      <View style={[styles.bColNum, styles.bNumCell]}>
        <Text style={[styles.bullionCell, styles.bSystemCell]} numberOfLines={1}>
          {formatQty(row.systemCount)}
        </Text>
      </View>
      {QTY_FIELDS.map((field) => (
        <View key={field} style={styles.bColInput}>
          <BullionQtyInput
            value={draft[field]}
            onChangeText={(value) => onChangeField(field, value)}
            onSubmitEditing={() => onSubmitField(field)}
            onBlur={SHIFT_FIELDS.includes(field) ? () => onBlurField?.(field) : undefined}
            inputRef={registerQtyInput(field)}
            label={QTY_HEADER_LABELS[field]}
          />
        </View>
      ))}
      <View style={styles.bColResult}>
        <Text style={[styles.bullionCell, styles.bTotalCell]} numberOfLines={1}>
          {formatQty(total)}
        </Text>
        <DiffBadge
          total={total}
          systemCount={row.systemCount}
          confirmed={showDiff}
          compact
        />
      </View>
      <View style={styles.bColAction}>
        <Pressable
          style={[styles.bSaveButton, busy && styles.rowActionDisabled]}
          onPress={onSave}
          disabled={busy}
          accessibilityLabel="Save to database"
        >
          {savingLocal ? (
            <ActivityIndicator size="small" color={TEXT} />
          ) : (
            <Ionicons name="save-outline" size={16} color={TEXT} />
          )}
        </Pressable>
        <Pressable
          style={[styles.bUpdateButton, busy && styles.rowActionDisabled]}
          onPress={onUpdate}
          disabled={busy}
          accessibilityLabel="Update Aureus"
        >
          {isSaving ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Ionicons name="checkmark" size={17} color="#fff" />
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
  savingLocal,
  savingAll,
  showDiff,
  onChangeField,
  onBlurField,
  onSave,
  onUpdate,
  registerQtyInput,
  onSubmitField,
}) {
  const total = countedTotalFromDraft(draft);
  const accent = metalAccent(row.metal);
  const mismatch =
    showDiff && Math.abs(total - (Number(row.systemCount) || 0)) >= 0.0005;
  const busy = isSaving || savingLocal || savingAll;

  return (
    <View style={[styles.ticketCard, mismatch && styles.bMobileCardOff]}>
      <View style={styles.bMobileHead}>
        <View style={[styles.bullionMetalDot, { backgroundColor: accent }]} />
        <View style={styles.bMobileTitleWrap}>
          <Text style={styles.bMobileName}>{row.name}</Text>
          {row.sku ? (
            <Text style={styles.bMobileSku} numberOfLines={1}>
              {row.sku}
            </Text>
          ) : null}
        </View>
        <DiffBadge total={total} systemCount={row.systemCount} confirmed={showDiff} />
      </View>

      <View style={styles.bMobileStats}>
        <View style={styles.bMobileStat}>
          <Text style={styles.bMobileStatLabel}>System</Text>
          <Text style={styles.bMobileStatValue}>{formatQty(row.systemCount)}</Text>
        </View>
        <View style={[styles.bMobileStat, styles.bMobileStatLast]}>
          <Text style={styles.bMobileStatLabel}>Physical</Text>
          <Text
            style={[
              styles.bMobileStatValue,
              mismatch && (total < (Number(row.systemCount) || 0) ? styles.short : styles.over),
            ]}
          >
            {formatQty(total)}
          </Text>
        </View>
      </View>

      <HistoryStrip historyDates={historyDates} history={row.history} variant="card" />

      {QTY_FIELDS.map((field, index) => (
        <TicketFieldRow key={field} label={QTY_HEADER_LABELS[field]} last={index === QTY_FIELDS.length - 1}>
          <BullionQtyInput
            value={draft[field]}
            onChangeText={(value) => onChangeField(field, value)}
            onSubmitEditing={() => onSubmitField(field)}
            onBlur={SHIFT_FIELDS.includes(field) ? () => onBlurField?.(field) : undefined}
            inputRef={registerQtyInput(field)}
            label={QTY_HEADER_LABELS[field]}
            plain
          />
        </TicketFieldRow>
      ))}

      <View style={styles.bMobileActions}>
        <Pressable
          style={[styles.bMobileSave, busy && styles.rowActionDisabled]}
          onPress={onSave}
          disabled={busy}
          accessibilityLabel="Save to database"
        >
          {savingLocal ? (
            <ActivityIndicator size="small" color={ACCENT} />
          ) : (
            <Text style={styles.bMobileSaveText}>Save</Text>
          )}
        </Pressable>
        <Pressable
          style={[styles.bMobileUpdate, busy && styles.rowActionDisabled]}
          onPress={onUpdate}
          disabled={busy}
          accessibilityLabel="Update Aureus"
        >
          {isSaving ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.bMobileUpdateText}>Update</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

function CashTxnRow({
  row,
  last = false,
  fallbackLabel = '—',
  cashSaved = false,
  onCashPress,
}) {
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
      <View style={styles.cashTxnAmountWrap}>
        {onCashPress ? (
          <TxnCashIcon saved={cashSaved} onPress={() => onCashPress(row)} />
        ) : null}
        <Text style={[styles.cashTxnAmount, inbound ? styles.cashIn : styles.cashOut]} numberOfLines={1}>
          {row.amountLabel}
        </Text>
      </View>
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

function CashStepButton({ onPress, disabled, icon, large = false }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={6}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.cashStepBtn,
        large && styles.cashStepBtnLarge,
        disabled && styles.cashStepBtnDisabled,
        pressed && !disabled && styles.cashStepBtnPressed,
      ]}
    >
      <Ionicons name={icon} size={large ? 20 : 16} color={disabled ? CHEVRON : TEXT} />
    </Pressable>
  );
}

function LooseDenomTile({
  denom,
  countText,
  amount,
  money,
  onChangeText,
  onBump,
  onSubmitEditing,
  inputRef,
  compact,
  expected,
  countedPieces,
  openingMissing,
}) {
  const filled = String(countText || '').trim() !== '';
  const qty = parseQtyInput(countText) ?? 0;
  const showExpected = expected != null && (expected !== 0 || !openingMissing);
  const expectedTone =
    showExpected && countedPieces != null && (filled || countedPieces > 0)
      ? countedPieces === expected
        ? styles.looseTileExpectedOk
        : styles.looseTileExpectedOff
      : styles.looseTileExpected;
  return (
    <View
      style={[
        styles.looseTile,
        compact && styles.looseTileCompact,
        filled && styles.looseTileFilled,
      ]}
    >
      <View style={[styles.looseTileStripe, { backgroundColor: denom.color }]} />
      <Text style={styles.looseTileFace}>{denomTitle(denom)}</Text>
      {showExpected ? (
        <Text style={expectedTone}>
          {openingMissing
            ? `${expected > 0 ? '+' : ''}${expected} txn`
            : `exp ${expected}`}
        </Text>
      ) : (
        <Text style={styles.looseTileUnit}>
          {filled ? `${qty} ${denomPieceLabel(denom, qty)}` : denomPieceLabel(denom, 0)}
        </Text>
      )}
      <View style={styles.looseTileStepper}>
        <CashStepButton
          icon="remove"
          disabled={qty <= 0}
          onPress={() => onBump(-1)}
          large={compact}
        />
        <CashCountInput
          value={countText}
          onChangeText={onChangeText}
          onSubmitEditing={onSubmitEditing}
          inputRef={inputRef}
          label={`${denomTitle(denom)} loose`}
          style={compact ? styles.looseTileInputLarge : styles.looseTileInput}
        />
        <CashStepButton icon="add" onPress={() => onBump(1)} large={compact} />
      </View>
      <Text style={[styles.looseTileValue, !filled && styles.looseTileValueMuted]}>
        {filled ? money(amount) : '—'}
      </Text>
    </View>
  );
}

function StrapRow({
  denom,
  countText,
  amount,
  money,
  onChangeText,
  onBump,
  onSubmitEditing,
  inputRef,
  last,
  compact,
}) {
  const filled = String(countText || '').trim() !== '';
  const qty = parseQtyInput(countText) ?? 0;
  return (
    <View
      style={[
        styles.strapRow,
        compact && styles.strapRowCompact,
        last && styles.strapRowLast,
        filled && styles.strapRowFilled,
      ]}
    >
      <View style={[styles.strapDot, { backgroundColor: denom.color }]} />
      <View style={[styles.strapCopy, compact && styles.strapCopyCompact]}>
        <Text style={styles.strapTitle}>{denomTitle(denom)}</Text>
        {compact ? null : <Text style={styles.strapHint}>{denomHint(denom)}</Text>}
      </View>
      <View style={styles.strapStepper}>
        <CashStepButton
          icon="remove"
          disabled={qty <= 0}
          onPress={() => onBump(-1)}
          large={compact}
        />
        <CashCountInput
          value={countText}
          onChangeText={onChangeText}
          onSubmitEditing={onSubmitEditing}
          inputRef={inputRef}
          label={`${denomTitle(denom)} ${denomStackLabel(denom, qty)}`}
          style={compact ? styles.strapInputLarge : styles.strapInput}
        />
        <CashStepButton icon="add" onPress={() => onBump(1)} large={compact} />
      </View>
      <Text
        style={[
          styles.strapAmount,
          compact && styles.strapAmountCompact,
          !filled && styles.looseTileValueMuted,
        ]}
      >
        {filled ? money(amount) : '—'}
      </Text>
    </View>
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
  initialDate,
  embedded = false,
}) {
  const { canFilter } = useAppAccess();
  const allowFilters = canFilter('audit');
  const isMobile = useIsMobile();
  const [date, setDate] = useState(() => parseDateParam(initialDate || new Date()));
  const [stores, setStores] = useState([]);
  const [selectedStoreName, setSelectedStoreName] = useState(storeFilter || null);
  const [rows, setRows] = useState([]);
  const [historyDates, setHistoryDates] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [confirmed, setConfirmed] = useState({});
  const [savingId, setSavingId] = useState('');
  const [savingKind, setSavingKind] = useState('');
  const [savingAll, setSavingAll] = useState(false);
  const [saveAllProgress, setSaveAllProgress] = useState('');
  const [query, setQuery] = useState('');
  const [hideZero, setHideZero] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const requestId = useRef(0);
  const storesRequestId = useRef(0);
  const qtyInputRefs = useRef(new Map());
  const shiftSaveTimers = useRef(new Map());
  const draftsRef = useRef({});

  const lockedStore = Boolean(storeFilter) || !allowFilters;
  const dateKey = formatDateParam(date);
  const todayKey = formatDateParam(parseDateParam(new Date()));
  const isToday = dateKey === todayKey;

  const selectedStore = useMemo(() => {
    if (!stores.length) return null;
    const match = findBullionStore(stores, selectedStoreName || storeFilter);
    if (match) return match;
    // When opened from Home → store, never fall back to a different store.
    if (lockedStore) return null;
    return stores[0];
  }, [stores, selectedStoreName, storeFilter, lockedStore]);

  const txnDrawer = useAuditTxnDrawer(session, {
    token: selectedStore?.token || session?.token,
    baseUrl: selectedStore?.baseUrl || session?.baseUrl,
  });
  const setTxnLookup = txnDrawer.setLookup;
  const closeTxnDrawer = txnDrawer.close;

  // SO#/PO# links from the day analysis and the range review share one drawer.
  const lookupRef = useRef({ day: [], range: [] });
  const applyLookup = useCallback(() => {
    setTxnLookup([...lookupRef.current.day, ...lookupRef.current.range]);
  }, [setTxnLookup]);

  const rangeChat = useAuditRangeChat();
  const resetRangeChat = rangeChat.reset;
  const [rangeDates, setRangeDates] = useState(() => ({
    start: shiftDateParam(dateKey, -6),
    end: dateKey,
  }));
  const setRange = useCallback((start, end) => setRangeDates({ start, end }), []);

  useEffect(() => {
    if (storeFilter) setSelectedStoreName(storeFilter);
  }, [storeFilter]);

  useEffect(() => {
    if (initialDate) setDate(parseDateParam(initialDate));
  }, [initialDate]);

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
          if (storeFilter) {
            return findBullionStore(result, storeFilter)?.name || storeFilter;
          }
          if (prev && findBullionStore(result, prev)) return prev;
          return result[0]?.name || null;
        });
        if (storeFilter && !findBullionStore(result, storeFilter)) {
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
          afternoon: qtyInputText(row.afternoonCount),
          store: qtyInputText(row.storeCount),
          other: qtyInputText(row.otherCount),
        };
        if (row.amount != null || row.nightCount != null || row.afternoonCount != null) {
          nextConfirmed[row.id] = true;
        }
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
    const timers = shiftSaveTimers.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, []);

  useEffect(() => {
    lookupRef.current.day = [];
    applyLookup();
    closeTxnDrawer();
  }, [dateKey, selectedStore?.id, selectedStore?.systemKey, applyLookup, closeTxnDrawer]);

  // The range review survives day changes; only a different store clears it.
  useEffect(() => {
    resetRangeChat();
    lookupRef.current.range = [];
    applyLookup();
  }, [selectedStore?.id, selectedStore?.systemKey, resetRangeChat, applyLookup]);

  const visibleRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (
        hideZero &&
        !(row.systemCount > 0 || row.amount > 0 || row.nightCount > 0 || row.afternoonCount > 0)
      ) {
        const draft = drafts[row.id];
        const vault = parseQtyInput(draft?.vault);
        const night = parseQtyInput(draft?.night);
        const afternoon = parseQtyInput(draft?.afternoon);
        if (!(vault > 0) && !(night > 0) && !(afternoon > 0)) return false;
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

  const shiftTimerKey = (productId, field) => `${productId}:${field}`;

  const clearShiftSaveTimer = (productId, field) => {
    const timers = shiftSaveTimers.current;
    const keys = field
      ? [shiftTimerKey(productId, field)]
      : SHIFT_FIELDS.map((name) => shiftTimerKey(productId, name));
    for (const key of keys) {
      const timer = timers.get(key);
      if (timer) clearTimeout(timer);
      timers.delete(key);
    }
  };

  const persistShiftCount = async (productId, field, value) => {
    if (!selectedStore?.name || !SHIFT_FIELDS.includes(field)) return;
    clearShiftSaveTimer(productId, field);
    const save = field === 'afternoon' ? saveAfternoonCount : saveNightCount;
    const saved = await save(
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
              nightCount: field === 'night' ? saved : entry.nightCount,
              afternoonCount: field === 'afternoon' ? saved : entry.afternoonCount,
              amount: countedPhysicalTotal(
                entry.vaultCount,
                field === 'night' ? saved : entry.nightCount,
                field === 'afternoon' ? saved : entry.afternoonCount,
              ),
            }
          : entry,
      ),
    );
  };

  const flushShiftField = (row, field) => {
    if (!SHIFT_FIELDS.includes(field)) return;
    const next = parseQtyInput(draftsRef.current[row.id]?.[field]);
    const current = field === 'afternoon' ? row.afternoonCount : row.nightCount;
    if (next == null && current == null) return;
    persistShiftCount(row.id, field, draftsRef.current[row.id]?.[field]).catch((err) => {
      setError(err?.message || `Failed to save ${field} count.`);
    });
  };

  const scheduleShiftSave = (productId, field, value) => {
    if (!selectedStore?.name || !SHIFT_FIELDS.includes(field)) return;
    clearShiftSaveTimer(productId, field);
    const storeName = selectedStore.name;
    const userId = session?.supabaseUserId;
    const key = shiftTimerKey(productId, field);
    const save = field === 'afternoon' ? saveAfternoonCount : saveNightCount;
    shiftSaveTimers.current.set(
      key,
      setTimeout(() => {
        shiftSaveTimers.current.delete(key);
        save(storeName, productId, parseQtyInput(value), userId).catch((err) => {
          setError(err?.message || `Failed to save ${field} count.`);
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
    if (SHIFT_FIELDS.includes(field)) scheduleShiftSave(productId, field, value);
    setConfirmed((prev) => {
      if (SHIFT_FIELDS.includes(field)) {
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
      String(draft.night || '').trim() !== '' ||
      String(draft.afternoon || '').trim() !== '' ||
      String(draft.store || '').trim() !== '' ||
      String(draft.other || '').trim() !== ''
    );
  };

  const persistRow = async (row, { aureus = false } = {}) => {
    const draft = draftsRef.current[row.id] || drafts[row.id] || {};
    const vaultCount = parseQtyInput(draft.vault);
    const nightCount = parseQtyInput(draft.night);
    const afternoonCount = parseQtyInput(draft.afternoon);
    const storeCount = parseQtyInput(draft.store);
    const otherCount = parseQtyInput(draft.other);
    clearShiftSaveTimer(row.id);
    const physicalTotal = countedPhysicalTotal(vaultCount, nightCount, afternoonCount);
    const writes = [
      saveLocalBullionCounts(
        selectedStore.name,
        row.id,
        {
          vault: vaultCount,
          night: nightCount,
          afternoon: afternoonCount,
          store: storeCount,
          other: otherCount,
        },
        session?.supabaseUserId,
      ),
    ];
    if (aureus) {
      const token = selectedStore.token || session.token;
      const baseUrl = selectedStore.baseUrl || session.baseUrl;
      writes.push(
        saveInventoryLog(
          token,
          {
            productId: row.id,
            locationId: selectedStore.id,
            date: dateKey,
            vaultCount: physicalTotal,
            storeCount,
            otherCount,
          },
          baseUrl,
        ),
      );
    }
    const [saved] = await Promise.all(writes);
    return {
      id: row.id,
      vaultCount: saved.vault,
      nightCount: saved.night,
      afternoonCount: saved.afternoon,
      storeCount: saved.store,
      otherCount: saved.other,
      amount: physicalTotal,
    };
  };

  const applySavedRow = (saved) => {
    setRows((prev) =>
      prev.map((entry) =>
        entry.id === saved.id
          ? {
              ...entry,
              vaultCount: saved.vaultCount,
              nightCount: saved.nightCount,
              afternoonCount: saved.afternoonCount,
              storeCount: saved.storeCount,
              otherCount: saved.otherCount,
              amount: saved.amount,
            }
          : entry,
      ),
    );
    setConfirmed((prev) => ({ ...prev, [saved.id]: true }));
  };

  const applySavedMap = (savedById) => {
    setRows((prev) =>
      prev.map((entry) => {
        const saved = savedById.get(entry.id);
        if (!saved) return entry;
        return {
          ...entry,
          vaultCount: saved.vaultCount,
          nightCount: saved.nightCount,
          afternoonCount: saved.afternoonCount,
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
  };

  const writeRow = async (row, { aureus = false } = {}) => {
    const needsAureus = aureus;
    if (
      !selectedStore?.name ||
      (needsAureus && (!(selectedStore?.token || session?.token) || !selectedStore?.id)) ||
      savingId === row.id ||
      savingAll
    ) {
      return;
    }

    setSavingId(row.id);
    setSavingKind(aureus ? 'aureus' : 'local');
    setError('');
    try {
      const saved = await persistRow(row, { aureus });
      applySavedRow(saved);
    } catch (err) {
      setError(err?.message || (aureus ? 'Failed to update count.' : 'Failed to save count.'));
    } finally {
      setSavingId('');
      setSavingKind('');
    }
  };

  const saveRow = (row) => writeRow(row, { aureus: false });
  const updateRow = (row) => writeRow(row, { aureus: true });

  const writeAll = async ({ aureus = false } = {}) => {
    const needsAureus = aureus;
    if (
      !selectedStore?.name ||
      (needsAureus && (!(selectedStore?.token || session?.token) || !selectedStore?.id)) ||
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

    const verb = aureus ? 'Updating' : 'Saving';
    const doneVerb = aureus ? 'Updated' : 'Saved';
    setSavingAll(true);
    setSavingKind(aureus ? 'aureus' : 'local');
    setError('');
    setSaveAllProgress(`${verb} 0/${targets.length}…`);

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
          const saved = await persistRow(row, { aureus });
          savedById.set(saved.id, saved);
        } catch (err) {
          failures.push({
            name: row.name || row.sku || row.id,
            message: err?.message || 'Failed',
          });
        } finally {
          done += 1;
          setSaveAllProgress(`${verb} ${done}/${targets.length}…`);
        }
      }
    };

    try {
      await Promise.all(
        Array.from({ length: Math.min(concurrency, targets.length) }, () => worker()),
      );

      if (savedById.size) applySavedMap(savedById);

      if (failures.length) {
        const sample = failures
          .slice(0, 3)
          .map((item) => item.name)
          .join(', ');
        setError(
          `${doneVerb} ${savedById.size}/${targets.length}. Failed: ${sample}${
            failures.length > 3 ? ` (+${failures.length - 3} more)` : ''
          }.`,
        );
      }
    } finally {
      setSavingAll(false);
      setSavingKind('');
      setSaveAllProgress('');
    }
  };

  const saveAll = () => writeAll({ aureus: false });
  const updateAll = () => writeAll({ aureus: true });

  const runRangeReview = () => {
    if (!(selectedStore?.token || session?.token) || !selectedStore?.id || rangeChat.busy) return;
    setModelMenuOpen(false);
    const range = normalizeAuditRange(rangeDates.start, rangeDates.end);
    const store = selectedStore;
    rangeChat.run(
      ({ signal, onProgress, onDelta }) =>
        analyzeBullionRange({
          session,
          startDate: range.startDate,
          endDate: range.endDate,
          storeName: store.name,
          locationId: store.id,
          systemKey: store.systemKey,
          products: rows,
          focusProductIds: unbalancedItems.map((item) => item.id),
          model,
          signal,
          onProgress,
          onDelta,
        }).then((result) => {
          lookupRef.current.range = result.context?.lookupTransactions || [];
          applyLookup();
          return result;
        }),
      { label: `${store.name} · ${formatRangeLabel(range.startDate, range.endDate)}` },
    );
  };

  const sendRangeFollowUp = () =>
    rangeChat.send(({ messages, userMessage, signal, onDelta }) =>
      continueRangeChat({ kind: 'bullion', messages, userMessage, model, signal, onDelta }),
    );

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
      </GroupSection>
    );

    return content;
  };


  const storeSelectOptions = stores.map((store) => ({
    value: store.name,
    label: store.name,
  }));

  const renderSearchField = (style, ticket = false) => (
    ticket ? (
      <View style={styles.ticketSearchWrap}>
        <TextInput
          style={styles.ticketSearchInput}
          value={query}
          onChangeText={setQuery}
          placeholder="Item or SKU"
          placeholderTextColor={CHEVRON}
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
    ) : (
      <SearchField
        value={query}
        onChangeText={setQuery}
        placeholder="Item or SKU"
        style={[styles.chromeSearch, style]}
      />
    )
  );

  const renderZeroFilter = (ticket = false) =>
    allowFilters ? (
      ticket ? (
        <Pressable
          onPress={() => setHideZero((prev) => !prev)}
          style={styles.ticketToggleHit}
          accessibilityLabel={hideZero ? 'Showing non-zero' : 'Showing all'}
        >
          <Text style={styles.ticketFieldValue}>{hideZero ? 'Non-zero' : 'All'}</Text>
          <Ionicons name="chevron-down" size={14} color={CHEVRON} />
        </Pressable>
      ) : (
        <NavPills
          options={[
            { key: 'nonzero', label: 'Non-zero' },
            { key: 'all', label: 'All' },
          ]}
          value={hideZero ? 'nonzero' : 'all'}
          onChange={(next) => setHideZero(next === 'nonzero')}
          style={styles.zeroSlider}
        />
      )
    ) : null;

  const renderStoreControl = (selectStyle, ticket = false) =>
    lockedStore ? (
      ticket ? (
        <Text style={styles.ticketFieldValue} numberOfLines={1}>
          {selectedStore?.name || storeFilter || 'Store'}
        </Text>
      ) : (
      <Text style={[styles.storeTitle, isMobile && styles.storeTitleMobile]} numberOfLines={1}>
        {selectedStore?.name || storeFilter || 'Store'}
      </Text>
      )
    ) : (
      <FilterSelect
        label="Store"
        value={selectedStore?.name || selectedStoreName}
        options={storeSelectOptions}
        onChange={setSelectedStoreName}
        variant={ticket ? 'plain' : 'chip'}
        style={[!ticket && styles.storeSelect, ticket && styles.filterSelectPlainFill, selectStyle]}
      />
    );

  const renderRefreshButton = () => (
    <IconAction
      icon="refresh"
      onPress={load}
      accessibilityLabel="Refresh"
    />
  );

  const renderSaveAllButton = (style) => {
    const canSaveAll = visibleRows.some(rowHasDraftCounts);
    const localBusy = savingAll && savingKind === 'local';
    return (
      <Pressable
        style={[
          styles.fillButton,
          styles.fillButtonSave,
          style,
          (savingAll || savingId || !canSaveAll) && styles.fillButtonDisabled,
        ]}
        onPress={saveAll}
        disabled={savingAll || Boolean(savingId) || !canSaveAll}
      >
        {localBusy ? (
          <Text style={styles.fillButtonSaveText} numberOfLines={1}>
            {saveAllProgress || 'Saving…'}
          </Text>
        ) : (
          <Text style={styles.fillButtonSaveText} numberOfLines={1}>
            Save
          </Text>
        )}
      </Pressable>
    );
  };

  const renderUpdateAllButton = (style) => {
    const canUpdateAll = visibleRows.some(rowHasDraftCounts);
    const aureusBusy = savingAll && savingKind === 'aureus';
    if (style) {
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
          {aureusBusy ? (
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
    }
    return (
      <BarButton
        label={aureusBusy ? saveAllProgress || 'Updating…' : 'Update all'}
        onPress={updateAll}
        disabled={savingAll || Boolean(savingId) || !canUpdateAll}
        accessibilityLabel="Update all counts in Aureus"
      />
    );
  };

  const renderBullionToolbar = () => {
    if (isMobile) {
      return (
        <View style={styles.ticketCard}>
          <TicketFieldRow label="Store">
            {renderStoreControl(undefined, true)}
          </TicketFieldRow>
          <TicketFieldRow label="Date">
            <View style={styles.ticketFieldInline}>
              {isToday ? null : (
                <Pressable
                  onPress={() => setDate(parseDateParam(new Date()))}
                  hitSlop={8}
                  accessibilityLabel="Jump to today"
                >
                  <Text style={styles.ticketToday}>Today</Text>
                </Pressable>
              )}
              <DateChip label="Date" value={date} onChange={setDate} maximumDate={new Date()} variant="plain" />
            </View>
          </TicketFieldRow>
          <TicketFieldRow label="Search" last={!allowFilters}>
            {renderSearchField(undefined, true)}
          </TicketFieldRow>
          {allowFilters ? (
            <TicketFieldRow label="Show" last>
              {renderZeroFilter(true)}
            </TicketFieldRow>
          ) : null}
        </View>
      );
    }
    return (
      <View style={styles.pageChrome}>
        <View style={styles.pageChromeStart}>
          {renderSearchField()}
          {renderZeroFilter()}
        </View>
        <View style={styles.pageChromeEnd}>
          {renderStoreControl()}
          {isToday ? null : (
            <BarButton
              label="Today"
              onPress={() => setDate(parseDateParam(new Date()))}
              accessibilityLabel="Jump to today"
            />
          )}
          <DateChip label="Date" value={date} onChange={setDate} maximumDate={new Date()} />
          {renderRefreshButton()}
          {renderUpdateAllButton()}
          {renderSaveAllButton()}
        </View>
      </View>
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

  const renderBullionMeta = () => (
    <>
      <View style={[styles.metaRow, isMobile && styles.metaRowMobile]}>
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
        ) : (
          isMobile ? renderRefreshButton() : null
        )}
      </View>
      {error ? <Text style={[styles.errorText, styles.metaError]}>{error}</Text> : null}
    </>
  );

  return (
    <KeyboardAvoidingView
      style={[styles.panelBody, embedded && styles.panelBodyEmbedded, isMobile && styles.panelBodyMobile]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {isMobile ? null : (
        <>
          {renderBullionToolbar()}
          {renderBullionMeta()}
        </>
      )}

      <ScrollView
        style={styles.appleScroll}
        contentContainerStyle={[styles.appleScrollContent, isMobile && styles.appleScrollContentMobile]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
      >
        {isMobile ? (
          <>
            {renderBullionToolbar()}
            {renderBullionMeta()}
          </>
        ) : null}
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
              const isSaving = savingId === row.id && savingKind === 'aureus';
              const savingLocal = savingId === row.id && savingKind === 'local';
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
                    savingLocal={savingLocal}
                    savingAll={savingAll}
                    showDiff={showDiff}
                    onChangeField={(field, value) => setDraftField(row.id, field, value)}
                    onBlurField={(field) => flushShiftField(row, field)}
                    onSave={() => saveRow(row)}
                    onUpdate={() => updateRow(row)}
                    registerQtyInput={(field) => registerQtyInput(row.id, field)}
                    onSubmitField={(field) => {
                      flushShiftField(row, field);
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
              <View style={styles.bullionTable}>
                <View style={[styles.bullionRow, styles.bullionHeaderRow]}>
                  <View style={styles.bAccent} />
                  <View style={[styles.bColItem, styles.bHeadCell]}>
                    <Text style={styles.bullionH} numberOfLines={1}>
                      Item
                    </Text>
                  </View>
                  <View style={[styles.bColNum, styles.bHeadCell, styles.bHeadCellEnd]}>
                    <Text style={styles.bullionH} numberOfLines={1}>
                      Sys
                    </Text>
                  </View>
                  {QTY_FIELDS.map((field) => (
                    <View key={field} style={[styles.bColInput, styles.bHeadCell, styles.bHeadCellCenter]}>
                      <Text style={[styles.bullionH, styles.bullionHFill]} numberOfLines={1}>
                        {QTY_HEADER_LABELS[field]}
                      </Text>
                    </View>
                  ))}
                  <View style={[styles.bColResult, styles.bHeadCell, styles.bHeadCellEnd]}>
                    <Text style={styles.bullionH} numberOfLines={1}>
                      Count
                    </Text>
                  </View>
                  <View style={styles.bColAction} />
                </View>
                {visibleRows.map((row, rowIndex) => {
                  const draft = drafts[row.id] || emptyQtyDraft();
                  const isSaving = savingId === row.id && savingKind === 'aureus';
                  const savingLocal = savingId === row.id && savingKind === 'local';
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
                        isSaving={isSaving}
                        savingLocal={savingLocal}
                        savingAll={savingAll}
                        showDiff={showDiff}
                        onChangeField={(field, value) => setDraftField(row.id, field, value)}
                        onBlurField={(field) => flushShiftField(row, field)}
                        onSave={() => saveRow(row)}
                        onUpdate={() => updateRow(row)}
                        registerQtyInput={(field) => registerQtyInput(row.id, field)}
                        onSubmitField={(field) => {
                          flushShiftField(row, field);
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
        <RangeReviewSection
          isMobile={isMobile}
          startDate={rangeDates.start}
          endDate={rangeDates.end}
          onChangeRange={setRange}
          chat={rangeChat}
          onRun={runRangeReview}
          onSend={sendRangeFollowUp}
          canRun={Boolean(selectedStore?.id)}
          runHint="Walks every vault count, sale, purchase, transfer, delivery, payment, and POS edit for this store across the selected dates, then explains when and why each metal drifted."
          placeholder="Ask about a metal, a day, an SO/PO/TR, or an undelivered line…"
          onOpenReference={txnDrawer.openReference}
          model={model}
          onChangeModel={setModel}
          modelMenuOpen={modelMenuOpen}
          onToggleModelMenu={setModelMenuOpen}
        />
      </ScrollView>

      {isMobile ? (
        <View style={[styles.stickyBar, embedded && styles.stickyBarEmbedded]}>
          {renderSaveAllButton(styles.fillButtonMobileFlex)}
          {renderUpdateAllButton(styles.fillButtonMobileFlex)}
        </View>
      ) : null}

      <AuditTxnDrawer
        visible={txnDrawer.visible}
        summary={txnDrawer.summary}
        detail={txnDrawer.detail}
        loading={txnDrawer.loading}
        error={txnDrawer.error}
        onClose={txnDrawer.close}
      />
    </KeyboardAvoidingView>
  );
}

function CashAuditPanel({
  session,
  onRequireLogin,
  storeFilter,
  initialDate,
  embedded = false,
}) {
  const { canFilter } = useAppAccess();
  const allowFilters = canFilter('audit');
  const isMobile = useIsMobile();
  const [date, setDate] = useState(() => parseDateParam(initialDate || new Date()));
  const [selectedStore, setSelectedStore] = useState(
    resolveCashStoreName(storeFilter) || AUDIT_CASH_STORES[0] || null,
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
  const requestId = useRef(0);
  const cashInputRefs = useRef(new Map());
  const cashCountHydrating = useRef(false);
  const [openingSheets, setOpeningSheets] = useState({ cad: null, usd: null });
  const [daySlips, setDaySlips] = useState([]);
  const [cashSaving, setCashSaving] = useState(false);
  const [cashSavedAt, setCashSavedAt] = useState(null);
  const [cashSaveError, setCashSaveError] = useState('');

  const lockedStore = Boolean(storeFilter) || !allowFilters;
  const dateKey = formatDateParam(date);
  const todayKey = formatDateParam(parseDateParam(new Date()));
  const isToday = dateKey === todayKey;

  const txnDrawer = useAuditTxnDrawer(session, {
    token: session?.token,
    baseUrl: session?.baseUrl,
  });
  const setTxnLookup = txnDrawer.setLookup;
  const closeTxnDrawer = txnDrawer.close;

  const lookupRef = useRef({ day: [], range: [] });
  const applyLookup = useCallback(() => {
    setTxnLookup([...lookupRef.current.day, ...lookupRef.current.range]);
  }, [setTxnLookup]);

  const rangeChat = useAuditRangeChat();
  const resetRangeChat = rangeChat.reset;
  const [rangeDates, setRangeDates] = useState(() => ({
    start: shiftDateParam(dateKey, -6),
    end: dateKey,
  }));
  const setRange = useCallback((start, end) => setRangeDates({ start, end }), []);

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
    if (storeFilter) setSelectedStore(resolveCashStoreName(storeFilter));
  }, [storeFilter]);

  useEffect(() => {
    if (initialDate) setDate(parseDateParam(initialDate));
  }, [initialDate]);

  const load = useCallback(async ({ silent = false } = {}) => {
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
    if (!silent) {
      setLoading(true);
      setError('');
      setWarning('');
    }

    try {
      const result = await fetchStoreCashPosition(session, {
        date: dateKey,
        storeName: selectedStore,
      });
      if (id !== requestId.current) return;
      setPosition((current) => (sameJson(current, result) ? current : result));
      setWarning(result.warning || '');
      setError('');
    } catch (err) {
      if (id !== requestId.current) return;
      if (silent) return;
      setPosition(null);
      setError(err?.message || 'Failed to load cash position.');
      setWarning('');
    } finally {
      if (id === requestId.current && !silent) setLoading(false);
    }
  }, [session, dateKey, selectedStore]);

  useEffect(() => {
    load();
  }, [load]);

  useLiveRefresh(load, AUREUS_CASH_LIVE_MS, Boolean(session?.token && selectedStore));

  useEffect(() => {
    let cancelled = false;
    cashCountHydrating.current = true;
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
    setCashSaving(false);
    setCashSavedAt(null);
    setCashSaveError('');

    if (!selectedStore) {
      cashCountHydrating.current = false;
      return undefined;
    }

    loadStoreCashCounts(selectedStore, dateKey)
      .then((saved) => {
        if (cancelled) return;
        if (saved.cad) {
          setLooseCounts(saved.cad.loose);
          setStackCounts(saved.cad.stacks);
          setOtherCashText(saved.cad.otherCash);
          setCountedTotalText(saved.cad.countedTotal);
          setCountedManual(saved.cad.countedManual);
        }
        if (saved.usd) {
          setUsdLooseCounts(saved.usd.loose);
          setUsdStackCounts(saved.usd.stacks);
          setUsdOtherCashText(saved.usd.otherCash);
          setUsdCountedTotalText(saved.usd.countedTotal);
          setUsdCountedManual(saved.usd.countedManual);
        }
        if (saved.cad || saved.usd) {
          const stamp = saved.cad?.updatedAt || saved.usd?.updatedAt;
          setCashSavedAt(stamp ? new Date(stamp) : new Date());
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) {
          setTimeout(() => {
            cashCountHydrating.current = false;
          }, 0);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [dateKey, selectedStore]);

  useEffect(() => {
    lookupRef.current.day = [];
    applyLookup();
    closeTxnDrawer();
  }, [dateKey, selectedStore, applyLookup, closeTxnDrawer]);

  // The range review survives day changes; only a different store clears it.
  useEffect(() => {
    resetRangeChat();
    lookupRef.current.range = [];
    applyLookup();
  }, [selectedStore, resetRangeChat, applyLookup]);

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
  const aureusOnHand = activeDrawer?.aureusOnHand ?? expectedOnHand;
  const posPhysical = activeDrawer?.todayPhysical ?? 0;
  const usdAureusOnHand = position?.usd?.aureusOnHand ?? position?.usd?.expectedOnHand ?? 0;
  const showUsdAside = !isUsdDrawer && Math.abs(usdAureusOnHand) >= 0.005;
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

  const cashSlipRows = useMemo(
    () => [
      ...(position?.cad?.paymentRows || []),
      ...(position?.cad?.cashTransactions || []),
      ...(position?.usd?.paymentRows || []),
      ...(position?.usd?.cashTransactions || []),
    ],
    [position],
  );
  const cashSlips = useTxnCashBreakdowns(cashSlipRows);

  useEffect(() => {
    if (!selectedStore || !position?.previousDate) {
      setOpeningSheets({ cad: null, usd: null });
      return undefined;
    }
    let cancelled = false;
    loadStoreCashCounts(selectedStore, position.previousDate)
      .then((saved) => {
        if (!cancelled) setOpeningSheets({ cad: saved.cad, usd: saved.usd });
      })
      .catch(() => {
        if (!cancelled) setOpeningSheets({ cad: null, usd: null });
      });
    return () => {
      cancelled = true;
    };
  }, [selectedStore, position?.previousDate]);

  useEffect(() => {
    if (!selectedStore || !dateKey) {
      setDaySlips([]);
      return undefined;
    }
    let cancelled = false;
    loadStoreDayTxnCashBreakdowns(selectedStore, dateKey)
      .then((rows) => {
        if (!cancelled) setDaySlips(rows);
      })
      .catch(() => {
        if (!cancelled) setDaySlips([]);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedStore, dateKey, cashSlips.savedKey]);

  const openingPieces = useMemo(() => {
    const sheet = isUsdDrawer ? openingSheets.usd : openingSheets.cad;
    if (!sheet || !hasSheetValues(sheet)) return null;
    return piecesFromSheet(activeDenoms, sheet.loose, sheet.stacks);
  }, [isUsdDrawer, openingSheets, activeDenoms]);

  const mergedSlips = useMemo(() => {
    const map = {};
    for (const row of daySlips) {
      if (row?.transactionId) map[row.transactionId] = row;
    }
    for (const [id, sheet] of Object.entries(cashSlips.byId)) {
      if (sheet?.hasCount) map[id] = sheet;
      else delete map[id];
    }
    return Object.values(map);
  }, [daySlips, cashSlips.byId]);

  const txnPieces = useMemo(
    () => sumBreakdownPieces(mergedSlips, currency),
    [mergedSlips, currency],
  );
  const expectedPieces = useMemo(() => {
    if (!openingPieces && !txnPieces.count) return null;
    return addPieceMaps(openingPieces || {}, txnPieces.net);
  }, [openingPieces, txnPieces]);
  const openingMissing = !openingPieces;
  const expectedLine = expectedPieces ? pieceBreakdownLine(activeDenoms, expectedPieces) : '';

  const persistCashCounts = useCallback(async () => {
    if (!selectedStore) {
      setCashSaveError('Choose a store.');
      return false;
    }
    const hasCad =
      cadDenom.hasDenomCount || String(countedTotalText || '').trim() !== '';
    const hasUsd =
      usdDenom.hasDenomCount || String(usdCountedTotalText || '').trim() !== '';
    if (!hasCad && !hasUsd) {
      setCashSaveError('Enter a bill or coin count first.');
      return false;
    }

    setCashSaving(true);
    setCashSaveError('');
    try {
      const userId = session?.supabaseUserId;
      const writes = [];
      if (hasCad) {
        writes.push(
          saveStoreCashCount(
            selectedStore,
            dateKey,
            'CAD',
            {
              loose: looseCounts,
              stacks: stackCounts,
              otherCash: otherCashText,
              countedTotal: countedTotalText,
              countedManual,
            },
            userId,
          ),
        );
      }
      if (hasUsd) {
        writes.push(
          saveStoreCashCount(
            selectedStore,
            dateKey,
            'USD',
            {
              loose: usdLooseCounts,
              stacks: usdStackCounts,
              otherCash: usdOtherCashText,
              countedTotal: usdCountedTotalText,
              countedManual: usdCountedManual,
            },
            userId,
          ),
        );
      }
      await Promise.all(writes);
      setCashSavedAt(new Date());
      return true;
    } catch (err) {
      const message = err?.message || 'Failed to save cash count.';
      setCashSaveError(message);
      setError(message);
      return false;
    } finally {
      setCashSaving(false);
    }
  }, [
    selectedStore,
    dateKey,
    session?.supabaseUserId,
    cadDenom.hasDenomCount,
    usdDenom.hasDenomCount,
    looseCounts,
    stackCounts,
    otherCashText,
    countedTotalText,
    countedManual,
    usdLooseCounts,
    usdStackCounts,
    usdOtherCashText,
    usdCountedTotalText,
    usdCountedManual,
  ]);

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

  useEffect(() => {
    if (cashCountHydrating.current || !selectedStore) return undefined;
    const hasCad =
      cadDenom.hasDenomCount || String(countedTotalText || '').trim() !== '';
    const hasUsd =
      usdDenom.hasDenomCount || String(usdCountedTotalText || '').trim() !== '';
    if (!hasCad && !hasUsd) return undefined;
    setCashSavedAt(null);
    return undefined;
  }, [
    selectedStore,
    dateKey,
    looseCounts,
    stackCounts,
    otherCashText,
    countedTotalText,
    countedManual,
    usdLooseCounts,
    usdStackCounts,
    usdOtherCashText,
    usdCountedTotalText,
    usdCountedManual,
    cadDenom.hasDenomCount,
    usdDenom.hasDenomCount,
  ]);

  const cadCashOnHand = parseMoneyInput(countedTotalText);
  const usdCashOnHand = parseMoneyInput(usdCountedTotalText);
  const cashOnHand = isUsdDrawer ? usdCashOnHand : cadCashOnHand;
  const hasCount = cashOnHand != null;
  const variance = hasCount ? cashOnHand - expectedOnHand : null;
  const balanced = variance != null && Math.abs(variance) < 0.005;

  const runRangeReview = () => {
    if (!session?.token || !selectedStore || rangeChat.busy) return;
    setModelMenuOpen(false);
    const range = normalizeAuditRange(rangeDates.start, rangeDates.end);
    const storeName = selectedStore;
    rangeChat.run(
      ({ signal, onProgress, onDelta }) =>
        analyzeCashRange({
          session,
          startDate: range.startDate,
          endDate: range.endDate,
          storeName,
          model,
          signal,
          onProgress,
          onDelta,
        }).then((result) => {
          lookupRef.current.range = result.context?.lookupTransactions || [];
          applyLookup();
          return result;
        }),
      { label: `${storeName} · ${formatRangeLabel(range.startDate, range.endDate)}` },
    );
  };

  const sendRangeFollowUp = () =>
    rangeChat.send(({ messages, userMessage, signal, onDelta }) =>
      continueRangeChat({ kind: 'cash', messages, userMessage, model, signal, onDelta }),
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

  const bumpActiveLoose = (key, delta) => {
    setActiveLooseCounts((prev) => ({
      ...prev,
      [key]: bumpCountText(prev[key], delta),
    }));
  };

  const bumpActiveStacks = (key, delta) => {
    setActiveStackCounts((prev) => ({
      ...prev,
      [key]: bumpCountText(prev[key], delta),
    }));
  };

  const focusNextCashInput = (key) => {
    const { bills, coins } = splitCashDenoms(activeDenoms);
    const ordered = [...bills, ...coins];
    const order = [
      ...ordered.map((denom) => `${denom.key}:loose`),
      ...ordered.map((denom) => `${denom.key}:stacks`),
      'other',
    ];
    const next = order[order.indexOf(key) + 1];
    if (!next) return;
    const node = cashInputRefs.current.get(next);
    if (node && typeof node.focus === 'function') node.focus();
  };

  const renderCashToolbar = () => {
    const storeControl = lockedStore ? (
      isMobile ? (
        <Text style={styles.ticketFieldValue} numberOfLines={1}>
          {selectedStore || 'Store'}
        </Text>
      ) : (
      <Text style={[styles.storeTitle, isMobile && styles.storeTitleMobile]} numberOfLines={1}>
        {selectedStore || 'Store'}
      </Text>
      )
    ) : (
      <FilterSelect
        label="Store"
        value={selectedStore}
        options={storeOptions.map((name) => ({ value: name, label: name }))}
        onChange={setSelectedStore}
        variant={isMobile ? 'plain' : 'chip'}
        style={[!isMobile && styles.storeSelect, isMobile && styles.filterSelectPlainFill]}
      />
    );
    const drawerControl = (
      <NavPills
        options={CASH_DRAWERS.map((drawer) => ({
          key: drawer.key,
          label: drawer.key === 'usd' ? 'USD' : 'CAD',
        }))}
        value={cashDrawer}
        onChange={setCashDrawer}
        style={isMobile ? styles.drawerSliderMobile : styles.drawerSlider}
      />
    );
    const dateRow = (
      <>
        {isToday ? null : (
          <BarButton
            label="Today"
            onPress={() => setDate(parseDateParam(new Date()))}
            accessibilityLabel="Jump to today"
          />
        )}
        <DateChip label="Date" value={date} onChange={setDate} maximumDate={new Date()} />
        <IconAction icon="refresh" onPress={load} accessibilityLabel="Refresh" />
      </>
    );
    const canSaveCash =
      cadDenom.hasDenomCount ||
      usdDenom.hasDenomCount ||
      String(countedTotalText || '').trim() !== '' ||
      String(usdCountedTotalText || '').trim() !== '';
    const saveButton = (
      <Pressable
        style={[
          styles.fillButton,
          styles.fillButtonSave,
          isMobile && styles.fillButtonMobile,
          (cashSaving || !canSaveCash) && styles.fillButtonDisabled,
        ]}
        onPress={persistCashCounts}
        disabled={cashSaving || !canSaveCash}
        accessibilityLabel="Save cash to database"
      >
        {cashSaving ? (
          <Text style={styles.fillButtonSaveText} numberOfLines={1}>
            Saving…
          </Text>
        ) : (
          <Text style={styles.fillButtonSaveText} numberOfLines={1}>
            Save
          </Text>
        )}
      </Pressable>
    );

    if (isMobile) {
      return (
        <View style={styles.cashMobileToolbar}>
          <View style={styles.ticketCard}>
            <TicketFieldRow label="Store">
              {storeControl}
            </TicketFieldRow>
            <TicketFieldRow label="Date" last>
              <View style={styles.ticketFieldInline}>
                {isToday ? null : (
                  <Pressable
                    onPress={() => setDate(parseDateParam(new Date()))}
                    hitSlop={8}
                    accessibilityLabel="Jump to today"
                  >
                    <Text style={styles.ticketToday}>Today</Text>
                  </Pressable>
                )}
                <DateChip label="Date" value={date} onChange={setDate} maximumDate={new Date()} variant="plain" />
              </View>
            </TicketFieldRow>
          </View>
          {drawerControl}
        </View>
      );
    }

    return (
      <View style={styles.pageChrome}>
        <View style={styles.pageChromeStart}>{drawerControl}</View>
        <View style={styles.pageChromeEnd}>
          {storeControl}
          {dateRow}
          {saveButton}
        </View>
      </View>
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
    const aureusHint =
      posPhysical > 0
        ? `POS counted ${money(posPhysical)}`
        : `Open ${money(openingBalance)} + today’s cash`;

    return (
      <View style={styles.cashHeroBlock}>
        <View style={[styles.cashHeroHead, isMobile && styles.cashHeroHeadMobile]}>
          <View style={styles.cashHeroCopy}>
            <Text style={styles.cashHeroKicker}>{isUsdDrawer ? 'Aureus USD' : 'Aureus CAD'}</Text>
            <Text style={styles.cashHeroAmount}>{money(aureusOnHand)}</Text>
            <Text style={styles.cashHeroHint} numberOfLines={2}>
              {aureusHint}
            </Text>
          </View>
          <View style={styles.cashHeroStats}>
            <View style={styles.cashHeroStatRow}>
              <Text style={styles.cashHeroStatLabel}>Counted</Text>
              <Text style={styles.cashHeroStatValue}>{hasCount ? money(cashOnHand) : '—'}</Text>
            </View>
            <View style={[styles.cashHeroStatRow, !showUsdAside && styles.cashHeroStatRowLast]}>
              <Text style={styles.cashHeroStatLabel}>Variance</Text>
              <Text
                style={[
                  styles.cashHeroStatValue,
                  varianceTone === 'ok' && styles.cashIn,
                  varianceTone === 'short' && styles.short,
                  varianceTone === 'over' && styles.over,
                ]}
              >
                {varianceLabel}
              </Text>
            </View>
            {showUsdAside ? (
              <View style={[styles.cashHeroStatRow, styles.cashHeroStatRowLast]}>
                <Text style={styles.cashHeroStatLabel}>USD till</Text>
                <Text style={styles.cashHeroStatValue}>
                  {formatAmount(usdAureusOnHand, 'USD')}
                </Text>
              </View>
            ) : null}
          </View>
        </View>
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
      </View>
    );
  };

  const renderMoneyFooter = ({ title, hint, value, onChangeText, inputKey, total, strong }) => (
    <View
      style={[
        styles.countFooterRow,
        isMobile && styles.countFooterRowMobile,
        strong && styles.countFooterRowStrong,
      ]}
    >
      <View style={[styles.countFooterCopy, isMobile && styles.countFooterCopyMobile]}>
        <View style={styles.looseHeadCopy}>
          <Text style={[styles.countFooterTitle, strong && styles.statLabelStrong]}>{title}</Text>
          <Text style={styles.countFooterHint}>{hint}</Text>
        </View>
        {isMobile ? (
          <Text style={[styles.countFooterTotal, strong && styles.statLabelStrong]}>{total}</Text>
        ) : null}
      </View>
      <View style={[styles.countFooterField, isMobile && styles.countFooterFieldMobile]}>
        <Text style={[styles.countFooterPrefix, isMobile && styles.countFooterPrefixMobile]}>
          {isUsdDrawer ? 'US$' : '$'}
        </Text>
        <CashCountInput
          value={value}
          onChangeText={onChangeText}
          onSubmitEditing={inputKey === 'other' ? () => focusNextCashInput('other') : undefined}
          inputRef={registerCashInput(inputKey)}
          label={title}
          money
          style={isMobile ? styles.cashCountInputPlainLarge : styles.cashCountInputPlain}
        />
      </View>
      {!isMobile ? (
        <Text style={[styles.countFooterTotal, strong && styles.statLabelStrong]}>{total}</Text>
      ) : null}
    </View>
  );

  const renderCashCount = () => {
    const { bills, coins } = splitCashDenoms(activeDenoms);
    const looseGroups = [
      bills.length ? { key: 'bills', title: 'Bills', denoms: bills } : null,
      coins.length ? { key: 'coins', title: 'Coins', denoms: coins } : null,
    ].filter(Boolean);
    const looseTotal = moneySum(denomColumnTotals.map((col) => col.loose));
    const strapsTotal = moneySum(denomColumnTotals.map((col) => col.stacks));
    const looseLine = looseBreakdownLine(activeDenoms, activeLooseCounts);
    const hasLoose = Boolean(looseLine);
    const hasStraps = activeDenoms.some(
      (denom) => String(activeStackCounts[denom.key] || '').trim() !== '',
    );

    const renderLooseTiles = (denoms) =>
      denoms.map((denom) => {
        const col = denomColumnTotals.find((entry) => entry.key === denom.key);
        const countedPieces = countedPiecesForDenom(
          denom,
          activeLooseCounts[denom.key],
          activeStackCounts[denom.key],
        );
        return (
          <LooseDenomTile
            key={denom.key}
            denom={denom}
            countText={activeLooseCounts[denom.key]}
            amount={col?.loose || 0}
            money={money}
            compact={isMobile}
            expected={expectedPieces ? expectedPieces[denom.key] || 0 : null}
            countedPieces={countedPieces}
            openingMissing={openingMissing}
            onChangeText={(value) =>
              setActiveLooseCounts((prev) => ({ ...prev, [denom.key]: value }))
            }
            onBump={(delta) => bumpActiveLoose(denom.key, delta)}
            onSubmitEditing={() => focusNextCashInput(`${denom.key}:loose`)}
            inputRef={registerCashInput(`${denom.key}:loose`)}
          />
        );
      });

    return (
      <GroupSection title={`Count ${drawerLabel}`}>
        <View style={styles.looseHead}>
          <View style={styles.looseHeadCopy}>
            <Text style={styles.looseHeadTitle}>Loose</Text>
            <Text style={styles.looseHeadHint} numberOfLines={isMobile ? 3 : 1}>
              {expectedLine
                ? `${expectedLine} · ${
                    openingMissing ? 'cash slips only' : 'last night + cash slips'
                  }`
                : hasLoose
                  ? looseLine
                  : 'Unstrapped bills and coins in the drawer'}
            </Text>
          </View>
          <Text style={styles.looseHeadAmount}>{hasLoose ? money(looseTotal) : '—'}</Text>
        </View>

        {looseGroups.map((group) => (
          <View key={group.key} style={styles.looseGroup}>
            {looseGroups.length > 1 ? (
              <Text style={styles.looseGroupTitle}>{group.title}</Text>
            ) : null}
            <View style={[styles.looseGrid, isMobile && styles.looseGridMobile]}>
              {renderLooseTiles(group.denoms)}
            </View>
          </View>
        ))}

        <View style={styles.strapHead}>
          <View style={styles.looseHeadCopy}>
            <Text style={styles.looseHeadTitle}>
              {isUsdDrawer || !coins.length ? 'Straps' : 'Straps & rolls'}
            </Text>
            <Text style={styles.looseHeadHint}>
              {isUsdDrawer ? '50 bills each' : '50-bill straps and coin rolls'}
            </Text>
          </View>
          <Text style={styles.looseHeadAmount}>{hasStraps ? money(strapsTotal) : '—'}</Text>
        </View>
        {activeDenoms.map((denom, index) => {
          const col = denomColumnTotals.find((entry) => entry.key === denom.key);
          return (
            <StrapRow
              key={denom.key}
              denom={denom}
              countText={activeStackCounts[denom.key]}
              amount={col?.stacks || 0}
              money={money}
              last={index === activeDenoms.length - 1}
              compact={isMobile}
              onChangeText={(value) =>
                setActiveStackCounts((prev) => ({ ...prev, [denom.key]: value }))
              }
              onBump={(delta) => bumpActiveStacks(denom.key, delta)}
              onSubmitEditing={() => focusNextCashInput(`${denom.key}:stacks`)}
              inputRef={registerCashInput(`${denom.key}:stacks`)}
            />
          );
        })}

        {renderMoneyFooter({
          title: 'Other',
          hint: 'Cheques, extras',
          value: activeOtherCashText,
          onChangeText: setActiveOtherCashText,
          inputKey: 'other',
          total: money(otherTotal),
        })}
        {renderMoneyFooter({
          title: 'Counted',
          hint: activeCountedManual ? 'Edited total' : 'Loose + straps + other',
          value: activeCountedTotalText,
          onChangeText: (value) => {
            setActiveCountedManual(true);
            setActiveCountedTotalText(value);
          },
          inputKey: 'counted',
          total: hasCount ? money(cashOnHand) : '—',
          strong: true,
        })}
        <View style={styles.cashSaveBar}>
          {cashSaveError ? <Text style={styles.cashSaveError}>{cashSaveError}</Text> : null}
          {isMobile ? null : (
          <Pressable
            onPress={persistCashCounts}
            disabled={cashSaving}
            style={({ pressed }) => [
              styles.cashSaveBtn,
              pressed && !cashSaving && styles.cashSaveBtnPressed,
              cashSaving && styles.cashSaveBtnDisabled,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Save cash breakdown"
          >
            {cashSaving ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.cashSaveBtnText}>Save</Text>
            )}
          </Pressable>
          )}
          <Text style={styles.cashSaveMeta}>
            {cashSavedAt
              ? `Saved ${cashSavedAt.toLocaleTimeString('en-CA', {
                  hour: 'numeric',
                  minute: '2-digit',
                })}`
              : 'Saves this store’s bill and coin count here, not to Aureus'}
          </Text>
        </View>
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
            cashSaved={cashSlips.isSaved(row)}
            onCashPress={cashSlips.openEditor}
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
            cashSaved={cashSlips.isSaved(row)}
            onCashPress={cashSlips.openEditor}
          />
        ))}
      </CashFold>
    </View>
  );

  const renderCashMeta = () => (
    <>
      <View style={[styles.metaRow, isMobile && styles.metaRowMobile]}>
        <Text style={styles.metaText} numberOfLines={1}>
          {loading && !position
            ? 'Loading…'
            : `${selectedStore || 'Store'} · ${
                isToday ? 'Today' : formatPickerDate(date)
              }`}
        </Text>
        {loading && position ? (
          <ActivityIndicator size="small" color={SECONDARY} />
        ) : isMobile ? (
          <Pressable
            style={styles.iconToggle}
            onPress={load}
            disabled={loading}
            accessibilityLabel="Refresh"
          >
            <Ionicons name="refresh" size={16} color={TEXT} />
          </Pressable>
        ) : null}
      </View>
      {error ? <Text style={[styles.errorText, styles.metaError]}>{error}</Text> : null}
      {warning ? <Text style={styles.warningText}>{warning}</Text> : null}
    </>
  );

  return (
    <KeyboardAvoidingView
      style={[styles.panelBody, embedded && styles.panelBodyEmbedded, isMobile && styles.panelBodyMobile]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {isMobile ? null : (
        <>
          {renderCashToolbar()}
          {renderCashMeta()}
        </>
      )}

      <ScrollView
        style={styles.appleScroll}
        contentContainerStyle={[styles.appleScrollContent, isMobile && styles.appleScrollContentMobile]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
      >
        {isMobile ? (
          <>
            {renderCashToolbar()}
            {renderCashMeta()}
          </>
        ) : null}
        {renderCashHero()}
        {renderCashCount()}
        {renderCashActivity()}
        <RangeReviewSection
          isMobile={isMobile}
          startDate={rangeDates.start}
          endDate={rangeDates.end}
          onChangeRange={setRange}
          chat={rangeChat}
          onRun={runRangeReview}
          onSend={sendRangeFollowUp}
          canRun={Boolean(selectedStore)}
          runHint="Rebuilds Till 1 CAD and USD day by day across the selected dates: opening vs prior count, every cash, debit, and cheque payment, till entries, whether each sale and purchase was actually paid, transfers, and POS edits."
          placeholder="Ask about a day, a drawer, an SO/PO, or whether something was paid…"
          onOpenReference={txnDrawer.openReference}
          model={model}
          onChangeModel={setModel}
          modelMenuOpen={modelMenuOpen}
          onToggleModelMenu={setModelMenuOpen}
        />
      </ScrollView>

      {isMobile ? (
        <View style={[styles.stickyBar, embedded && styles.stickyBarEmbedded]}>
          <Pressable
            style={[
              styles.fillButton,
              styles.fillButtonSave,
              styles.fillButtonMobile,
              (cashSaving ||
                !(
                  cadDenom.hasDenomCount ||
                  usdDenom.hasDenomCount ||
                  String(countedTotalText || '').trim() !== '' ||
                  String(usdCountedTotalText || '').trim() !== ''
                )) &&
                styles.fillButtonDisabled,
            ]}
            onPress={persistCashCounts}
            disabled={
              cashSaving ||
              !(
                cadDenom.hasDenomCount ||
                usdDenom.hasDenomCount ||
                String(countedTotalText || '').trim() !== '' ||
                String(usdCountedTotalText || '').trim() !== ''
              )
            }
            accessibilityLabel="Save cash to database"
          >
            {cashSaving ? (
              <Text style={styles.fillButtonSaveText}>Saving…</Text>
            ) : (
              <Text style={styles.fillButtonSaveText}>Save</Text>
            )}
          </Pressable>
        </View>
      ) : null}

      <AuditTxnDrawer
        visible={txnDrawer.visible}
        summary={txnDrawer.summary}
        detail={txnDrawer.detail}
        loading={txnDrawer.loading}
        error={txnDrawer.error}
        onClose={txnDrawer.close}
      />
      <TxnCashBreakdownModal
        visible={Boolean(cashSlips.editorRow)}
        session={session}
        row={cashSlips.editorRow}
        initialSheet={cashSlips.editorSheet}
        onClose={cashSlips.closeEditor}
        onSaved={cashSlips.onSaved}
      />
    </KeyboardAvoidingView>
  );
}


function NavPills({ options, value, onChange, compact = false, style }) {
  return (
    <View style={[styles.navPills, style]} accessibilityRole="tablist">
      {options.map((tab) => {
        const active = tab.key === value;
        const label = compact ? tab.shortLabel || tab.label : tab.label;
        return (
          <Pressable
            key={tab.key}
            onPress={() => onChange(tab.key)}
            style={({ hovered, pressed }) => [
              styles.navPill,
              (hovered || pressed) && !active && styles.navPillHover,
              active && styles.navPillActive,
            ]}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={tab.label}
          >
            <Text style={[styles.navPillText, active && styles.navPillTextActive]}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function AuditTabs({ value, onChange, compact = false }) {
  return <NavPills options={AUDIT_TABS} value={value} onChange={onChange} compact={compact} />;
}

export default function AuditScreen({
  session,
  onRequireLogin,
  storeFilter,
  initialDate,
  embedded = false,
  onNavTabs,
}) {
  const isMobile = useIsMobile();
  const [activeTab, setActiveTab] = useState('bullion');

  useLayoutEffect(() => {
    if (!onNavTabs) return undefined;
    onNavTabs(null);
    return () => onNavTabs(null);
  }, [onNavTabs]);

  return (
    <View
      style={[
        styles.body,
        embedded && styles.bodyEmbedded,
        isMobile && (embedded ? styles.panelBodyMobile : styles.auditPageMobile),
      ]}
    >
      <View style={[styles.localNavRow, isMobile && styles.localNavRowMobile]}>
        <AuditTabs value={activeTab} onChange={setActiveTab} compact={isMobile} />
      </View>

      {activeTab === 'bullion' ? (
        <BullionAuditPanel
          session={session}
          onRequireLogin={onRequireLogin}
          storeFilter={storeFilter}
          initialDate={initialDate}
          embedded={embedded}
        />
      ) : null}

      {activeTab === 'cash' ? (
        <CashAuditPanel
          session={session}
          onRequireLogin={onRequireLogin}
          storeFilter={storeFilter}
          initialDate={initialDate}
          embedded={embedded}
        />
      ) : null}

      {activeTab === 'item' ? (
        <ItemAuditPanel
          session={session}
          onRequireLogin={onRequireLogin}
          storeFilter={storeFilter}
          initialDate={initialDate}
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
    minWidth: 0,
    width: '100%',
    maxWidth: '100%',
    overflow: 'hidden',
    backgroundColor: PAGE,
    paddingHorizontal: 16,
  },
  bodyEmbedded: {
    flex: 1,
    minHeight: 0,
    minWidth: 0,
    width: '100%',
    maxWidth: '100%',
    overflow: 'hidden',
    backgroundColor: 'transparent',
    paddingHorizontal: 0,
  },
  localNavRow: {
    flexShrink: 0,
    flexDirection: 'row',
    justifyContent: 'flex-start',
    alignItems: 'center',
    paddingTop: 4,
    paddingBottom: 8,
  },
  localNavRowMobile: {
    paddingTop: 4,
    paddingBottom: 8,
  },
  navPills: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 2,
  },
  navPill: {
    minHeight: 36,
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderRadius: NAV_TAB_ACTIVE_RADIUS,
    borderWidth: 1,
    borderColor: 'transparent',
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  navPillHover: {
    backgroundColor: '#f5f5f5',
  },
  navPillActive: {
    borderColor: TAB_BORDER,
    backgroundColor: PAGE,
    ...CHIP_SHADOW,
  },
  navPillText: {
    fontFamily,
    fontSize: 14,
    fontWeight: '400',
    color: TEXT,
    letterSpacing: -0.2,
  },
  navPillTextActive: {
    fontWeight: '600',
  },
  pageChrome: {
    flexShrink: 0,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    paddingTop: 4,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: HEAD_RULE,
  },
  pageChromeStart: {
    flexShrink: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  pageChromeEnd: {
    marginLeft: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 0,
  },
  chromeSearch: {
    width: 220,
    maxWidth: 220,
  },
  zeroSlider: {
    minWidth: 168,
    maxWidth: 200,
  },
  drawerSlider: {
    minWidth: 168,
    maxWidth: 220,
  },
  drawerSliderMobile: {
    width: '100%',
    maxWidth: '100%',
    minWidth: 0,
    alignSelf: 'stretch',
  },
  storeTitleMobile: {
    maxWidth: '100%',
  },
  fillButtonMobile: {
    width: '100%',
    height: 44,
    minHeight: 44,
    borderRadius: NAV_TAB_ACTIVE_RADIUS,
  },
  fillButtonMobileFlex: {
    flex: 1,
    minWidth: 0,
    height: 44,
    minHeight: 44,
    borderRadius: NAV_TAB_ACTIVE_RADIUS,
  },
  fillButtonSave: {
    backgroundColor: ACCENT,
    borderColor: ACCENT,
  },
  fillButtonSaveText: {
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
    letterSpacing: -0.2,
  },
  appleDateField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: PAGE,
    borderRadius: NAV_TAB_ACTIVE_RADIUS,
    borderWidth: 1,
    borderColor: TAB_BORDER,
    paddingHorizontal: 10,
    height: 32,
    justifyContent: 'center',
    flexShrink: 0,
    ...CHIP_SHADOW,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  appleDateValue: {
    fontFamily,
    fontSize: 14,
    color: TEXT,
    letterSpacing: -0.2,
  },
  appleScroll: {
    flex: 1,
    minHeight: 0,
    minWidth: 0,
    width: '100%',
    maxWidth: '100%',
    ...Platform.select({
      web: { overflowX: 'hidden' },
      default: {},
    }),
  },
  appleScrollContent: {
    paddingBottom: 48,
    paddingTop: 8,
    gap: 20,
    width: '100%',
    maxWidth: '100%',
    minWidth: 0,
  },
  appleScrollContentMobile: {
    paddingTop: 0,
    paddingBottom: 24,
    gap: 16,
  },
  iconToggle: {
    width: 32,
    height: 32,
    borderRadius: NAV_TAB_ACTIVE_RADIUS,
    borderWidth: 1,
    borderColor: TAB_BORDER,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: PAGE,
    ...CHIP_SHADOW,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  fillButton: {
    height: 32,
    minHeight: 32,
    paddingHorizontal: 10,
    borderRadius: NAV_TAB_ACTIVE_RADIUS,
    borderWidth: 1,
    borderColor: TAB_BORDER,
    backgroundColor: PAGE,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    ...CHIP_SHADOW,
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
    fontSize: 14,
    fontWeight: '400',
    color: TEXT,
    letterSpacing: -0.2,
  },
  storeTitle: {
    fontFamily: FONT_LIGHT,
    fontSize: 16,
    fontWeight: '300',
    color: TEXT,
    letterSpacing: -0.2,
    flexShrink: 1,
    maxWidth: 180,
    lineHeight: 20,
  },
  storeSelect: {
    maxWidth: 160,
    minWidth: 104,
    height: 36,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
    marginBottom: 2,
    minHeight: 18,
  },
  metaRowMobile: {
    marginTop: 0,
    marginBottom: 0,
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
  groupSection: {
    width: '100%',
    gap: 8,
  },
  groupSectionTitle: {
    fontFamily: FONT_LIGHT,
    fontSize: 16,
    fontWeight: '300',
    color: TEXT,
    letterSpacing: -0.2,
    paddingHorizontal: 0,
  },
  group: {
    backgroundColor: PAGE,
    borderRadius: NAV_TAB_ACTIVE_RADIUS,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: TAB_BORDER,
    ...TICKET_SHADOW,
  },
  rowActionDisabled: {
    opacity: 0.45,
  },
  statRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 46,
    paddingLeft: 12,
    paddingRight: 12,
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(42,38,30,0.08)',
  },
  statRowLast: {
    borderBottomWidth: 0,
  },
  statLabel: {
    fontFamily: FONT_LIGHT,
    flex: 1,
    minWidth: 0,
    fontSize: 14,
    fontWeight: '400',
    color: TEXT,
    letterSpacing: -0.2,
  },
  statLabelStrong: {
    fontWeight: '600',
  },
  statValue: {
    fontFamily: FONT_LIGHT,
    fontSize: 14,
    fontWeight: '300',
    color: TEXT,
    letterSpacing: -0.2,
    fontVariant: ['tabular-nums'],
    textAlign: 'right',
    flexShrink: 0,
  },
  cashHeroBlock: {
    gap: 12,
  },
  cashHeroHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 24,
    paddingTop: 8,
    paddingBottom: 4,
  },
  cashHeroHeadMobile: {
    flexDirection: 'column',
    gap: 16,
  },
  cashHeroCopy: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  cashHeroKicker: {
    fontFamily,
    fontSize: 10,
    fontWeight: '500',
    color: '#aeaeb2',
    letterSpacing: 0.02,
  },
  cashHeroAmount: {
    fontFamily: FONT_LIGHT,
    fontSize: 22,
    lineHeight: 26,
    fontWeight: '300',
    color: TEXT,
    letterSpacing: -0.4,
    fontVariant: ['tabular-nums'],
  },
  cashHeroHint: {
    fontFamily,
    fontSize: 13,
    fontWeight: '400',
    color: SECONDARY,
    letterSpacing: -0.15,
  },
  cashHeroStats: {
    width: 248,
    maxWidth: '100%',
    flexShrink: 0,
    borderRadius: NAV_TAB_ACTIVE_RADIUS,
    borderWidth: 1,
    borderColor: TAB_BORDER,
    backgroundColor: PAGE,
    overflow: 'hidden',
    ...CHIP_SHADOW,
  },
  cashHeroStatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    minHeight: 32,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(42,38,30,0.08)',
  },
  cashHeroStatRowLast: {
    borderBottomWidth: 0,
  },
  cashHeroStatLabel: {
    fontFamily,
    fontSize: 14,
    fontWeight: '400',
    color: SECONDARY,
    letterSpacing: -0.2,
  },
  cashHeroStatValue: {
    fontFamily,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '400',
    color: TEXT,
    letterSpacing: -0.2,
    fontVariant: ['tabular-nums'],
    textAlign: 'right',
    flexShrink: 0,
  },
  looseHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 8,
  },
  strapHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: HAIRLINE,
  },
  looseHeadCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  looseHeadTitle: {
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: TEXT,
    letterSpacing: -0.2,
  },
  looseHeadHint: {
    fontFamily,
    fontSize: 13,
    color: SECONDARY,
    letterSpacing: -0.08,
  },
  looseHeadAmount: {
    fontFamily,
    fontSize: 20,
    fontWeight: '600',
    color: TEXT,
    letterSpacing: -0.4,
    fontVariant: ['tabular-nums'],
    flexShrink: 0,
  },
  looseGroup: {
    paddingBottom: 4,
  },
  looseGroupTitle: {
    fontFamily,
    fontSize: 12,
    fontWeight: '600',
    color: SECONDARY,
    letterSpacing: -0.08,
    paddingHorizontal: 16,
    paddingBottom: 6,
  },
  looseGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 12,
    paddingBottom: 8,
  },
  looseGridMobile: {
    gap: 8,
  },
  looseTile: {
    flexGrow: 1,
    flexBasis: 118,
    maxWidth: 168,
    minWidth: 110,
    backgroundColor: PAGE,
    borderRadius: NAV_TAB_ACTIVE_RADIUS,
    borderWidth: 1,
    borderColor: TAB_BORDER,
    paddingTop: 12,
    paddingBottom: 12,
    paddingHorizontal: 10,
    alignItems: 'center',
    gap: 6,
    overflow: 'hidden',
  },
  looseTileCompact: {
    flexBasis: '47%',
    maxWidth: '48.5%',
    minWidth: '46%',
    paddingTop: 14,
    paddingBottom: 14,
  },
  looseTileFilled: {
    backgroundColor: '#fff',
  },
  looseTileStripe: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 4,
  },
  looseTileExpected: {
    fontFamily,
    fontSize: 11,
    color: SECONDARY,
    letterSpacing: -0.08,
    marginBottom: 4,
  },
  looseTileExpectedOk: {
    fontFamily,
    fontSize: 11,
    color: GREEN,
    letterSpacing: -0.08,
    marginBottom: 4,
  },
  looseTileExpectedOff: {
    fontFamily,
    fontSize: 11,
    color: '#C47A12',
    letterSpacing: -0.08,
    marginBottom: 4,
  },
  cashTxnAmountWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 0,
  },
  looseTileFace: {
    fontFamily,
    fontSize: 22,
    fontWeight: '600',
    color: TEXT,
    letterSpacing: -0.5,
    marginTop: 4,
  },
  looseTileUnit: {
    fontFamily,
    fontSize: 12,
    fontWeight: '500',
    color: SECONDARY,
    letterSpacing: -0.08,
    marginTop: -4,
  },
  looseTileStepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    width: '100%',
  },
  looseTileInput: {
    flexGrow: 1,
    flexShrink: 1,
    width: 0,
    minWidth: 36,
    minHeight: 36,
    backgroundColor: FILL,
    borderRadius: 10,
    fontSize: 18,
  },
  looseTileInputLarge: {
    flexGrow: 1,
    flexShrink: 1,
    width: 0,
    minWidth: 40,
    minHeight: 44,
    backgroundColor: FILL,
    borderRadius: 12,
    fontSize: 22,
  },
  looseTileValue: {
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: TEXT,
    letterSpacing: -0.2,
    fontVariant: ['tabular-nums'],
  },
  looseTileValueMuted: {
    color: CHEVRON,
  },
  cashStepBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: FILL,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  cashStepBtnLarge: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  cashStepBtnDisabled: {
    opacity: 0.45,
  },
  cashStepBtnPressed: {
    opacity: 0.7,
  },
  strapRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 52,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: HAIRLINE,
  },
  strapRowLast: {
    borderBottomWidth: 0,
    marginBottom: 4,
  },
  strapRowCompact: {
    minHeight: 56,
    paddingVertical: 10,
  },
  strapCopyCompact: {
    width: 48,
  },
  strapInputLarge: {
    flexGrow: 1,
    flexShrink: 1,
    width: 0,
    minWidth: 44,
    minHeight: 44,
    backgroundColor: PAGE,
    borderWidth: 1,
    borderColor: TAB_BORDER,
    borderRadius: NAV_TAB_ACTIVE_RADIUS,
    fontSize: 22,
  },
  strapAmountCompact: {
    width: 72,
    fontSize: 16,
  },
  strapRowFilled: {
    backgroundColor: 'rgba(255,255,255,0.45)',
  },
  strapDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    flexShrink: 0,
  },
  strapCopy: {
    width: 72,
    flexShrink: 0,
    gap: 1,
  },
  strapTitle: {
    fontFamily,
    fontSize: 16,
    fontWeight: '600',
    color: TEXT,
    letterSpacing: -0.2,
  },
  strapHint: {
    fontFamily,
    fontSize: 11,
    color: SECONDARY,
    letterSpacing: -0.08,
  },
  strapStepper: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minWidth: 0,
  },
  strapInput: {
    flexGrow: 1,
    flexShrink: 1,
    width: 0,
    minWidth: 44,
    minHeight: 32,
    backgroundColor: PAGE,
    borderWidth: 1,
    borderColor: TAB_BORDER,
    borderRadius: NAV_TAB_ACTIVE_RADIUS,
    fontSize: 14,
  },
  strapAmount: {
    fontFamily,
    width: 84,
    fontSize: 15,
    fontWeight: '600',
    color: TEXT,
    letterSpacing: -0.2,
    fontVariant: ['tabular-nums'],
    textAlign: 'right',
    flexShrink: 0,
  },
  countFooterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 56,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: HAIRLINE,
  },
  countFooterRowStrong: {
    backgroundColor: FILL,
  },
  countFooterRowMobile: {
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: 8,
    paddingVertical: 12,
  },
  countFooterCopy: {
    width: 88,
    flexShrink: 0,
    gap: 1,
  },
  countFooterCopyMobile: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  countFooterTitle: {
    fontFamily,
    fontSize: 16,
    fontWeight: '600',
    color: TEXT,
    letterSpacing: -0.2,
  },
  countFooterHint: {
    fontFamily,
    fontSize: 12,
    color: SECONDARY,
    letterSpacing: -0.08,
  },
  countFooterField: {
    flex: 1,
    minWidth: 80,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: 32,
    paddingHorizontal: 10,
    borderRadius: NAV_TAB_ACTIVE_RADIUS,
    borderWidth: 1,
    borderColor: TAB_BORDER,
    backgroundColor: PAGE,
  },
  countFooterFieldMobile: {
    minHeight: 48,
    borderRadius: NAV_TAB_ACTIVE_RADIUS,
    backgroundColor: PAGE,
  },
  countFooterPrefix: {
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: SECONDARY,
    letterSpacing: -0.2,
  },
  countFooterPrefixMobile: {
    fontSize: 22,
  },
  cashSaveBar: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 16,
    gap: 8,
  },
  cashSaveBtn: {
    backgroundColor: ACCENT,
    borderRadius: 12,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cashSaveBtnPressed: {
    opacity: 0.88,
  },
  cashSaveBtnDisabled: {
    opacity: 0.7,
  },
  cashSaveBtnText: {
    fontFamily,
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  cashSaveError: {
    fontFamily,
    fontSize: 13,
    color: '#C47A12',
    letterSpacing: -0.08,
  },
  cashSaveMeta: {
    fontFamily,
    fontSize: 12,
    color: SECONDARY,
    letterSpacing: -0.08,
    textAlign: 'center',
  },
  countFooterTotal: {
    fontFamily,
    width: 84,
    fontSize: 15,
    fontWeight: '600',
    color: TEXT,
    letterSpacing: -0.2,
    fontVariant: ['tabular-nums'],
    textAlign: 'right',
    flexShrink: 0,
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
  cashCountInputPlain: {
    flexGrow: 1,
    flexShrink: 1,
    width: 0,
    backgroundColor: 'transparent',
    textAlign: 'left',
    minHeight: 28,
    paddingVertical: 0,
  },
  cashCountInputPlainLarge: {
    flexGrow: 1,
    flexShrink: 1,
    width: 0,
    backgroundColor: 'transparent',
    textAlign: 'left',
    minHeight: 44,
    fontSize: 22,
    paddingVertical: 0,
  },
  cashCountInput: {
    width: '100%',
    minHeight: 32,
    borderRadius: NAV_TAB_ACTIVE_RADIUS,
    borderWidth: 1,
    borderColor: TAB_BORDER,
    backgroundColor: PAGE,
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
    minWidth: 0,
    width: '100%',
    maxWidth: '100%',
    overflow: 'hidden',
    backgroundColor: PAGE,
  },
  panelBodyEmbedded: {
    flex: 1,
    minHeight: 0,
    minWidth: 0,
    width: '100%',
    maxWidth: '100%',
    overflow: 'hidden',
    backgroundColor: PAGE,
  },
  panelBodyMobile: {
    width: '100%',
    maxWidth: '100%',
    overflow: 'hidden',
    backgroundColor: PAGE,
  },
  auditPageMobile: {
    width: '100%',
    maxWidth: '100%',
    overflow: 'hidden',
    paddingHorizontal: 16,
    paddingTop: 8,
    backgroundColor: PAGE,
  },
  dateModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.28)',
    justifyContent: 'flex-end',
  },
  dateModalCard: {
    backgroundColor: PAGE,
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    paddingBottom: Platform.OS === 'ios' ? Math.max(20, mobileSafeBottom()) : 16,
  },
  dateModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: HAIRLINE,
  },
  dateModalTitle: {
    fontFamily,
    fontSize: 17,
    fontWeight: '600',
    color: TEXT,
    letterSpacing: -0.3,
  },
  dateModalDone: {
    fontFamily,
    fontSize: 17,
    fontWeight: '600',
    color: ACCENT,
  },
  errorText: {
    fontFamily,
    fontSize: 13,
    color: RED,
    letterSpacing: -0.08,
  },
  warningText: {
    fontFamily,
    fontSize: 12,
    color: ORANGE,
    marginBottom: 8,
  },
  hint: {
    fontFamily,
    fontSize: 17,
    color: SECONDARY,
  },
  link: {
    color: ACCENT,
    fontWeight: '400',
  },
  cashIn: {
    color: GREEN,
  },
  cashOut: {
    color: ORANGE,
  },
  over: {
    color: BLUE,
  },
  short: {
    color: RED,
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
    borderRadius: NAV_TAB_ACTIVE_RADIUS,
    borderWidth: 1,
    borderColor: TAB_BORDER,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: PAGE,
    minHeight: 32,
    ...CHIP_SHADOW,
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
    borderWidth: 1,
    borderColor: TAB_BORDER,
    borderRadius: NAV_TAB_ACTIVE_RADIUS,
    backgroundColor: PAGE,
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
    backgroundColor: '#EAF2FF',
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
    backgroundColor: ACCENT,
    borderRadius: NAV_TAB_ACTIVE_RADIUS,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minHeight: 32,
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
  bullionTableCard: {
    backgroundColor: PAGE,
    borderRadius: NAV_TAB_ACTIVE_RADIUS,
    borderWidth: 1,
    borderColor: TAB_BORDER,
    overflow: 'hidden',
    width: '100%',
    maxWidth: '100%',
    minWidth: 0,
    ...TICKET_SHADOW,
  },
  bullionTableScroll: {
    width: '100%',
    maxWidth: '100%',
    minWidth: 0,
    ...Platform.select({
      web: { overflowX: 'auto', overflowY: 'hidden' },
      default: {},
    }),
  },
  bullionTableScrollContent: {
    flexGrow: 0,
    width: BULLION_TABLE_MIN_WIDTH,
  },
  bullionTable: {
    width: BULLION_TABLE_MIN_WIDTH,
    minWidth: BULLION_TABLE_MIN_WIDTH,
    flexGrow: 0,
  },
  bullionRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    minHeight: 72,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e8e8e8',
    paddingVertical: 10,
    paddingRight: 12,
    gap: 10,
    ...Platform.select({
      web: {
        display: 'grid',
        gridTemplateColumns: BULLION_GRID,
        alignItems: 'start',
        columnGap: 10,
        gap: 10,
      },
      default: {},
    }),
  },
  bullionRowOff: {
    backgroundColor: 'rgba(255,59,48,0.06)',
  },
  bullionHeaderRow: {
    backgroundColor: PAGE,
    borderBottomColor: 'rgba(42,38,30,0.16)',
    minHeight: 36,
    paddingVertical: 8,
    alignItems: 'center',
    flexShrink: 0,
    ...Platform.select({
      web: { alignItems: 'center' },
      default: {},
    }),
  },
  bullionH: {
    fontFamily,
    fontSize: 11,
    fontWeight: '600',
    color: '#9a9a9a',
    letterSpacing: 0.2,
  },
  bullionHFill: {
    color: '#9a9a9a',
    textAlign: 'center',
    width: '100%',
  },
  bHeadCell: {
    justifyContent: 'center',
    minWidth: 0,
    overflow: 'hidden',
  },
  bHeadCellCenter: {
    alignItems: 'center',
  },
  bHeadCellEnd: {
    alignItems: 'flex-end',
  },
  bullionMetalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 34,
    paddingLeft: 12,
    paddingRight: 8,
    backgroundColor: FILL,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: HAIRLINE,
    width: '100%',
  },
  bullionMetalDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  bullionMetalTitle: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: TEXT,
    letterSpacing: -0.08,
  },
  bullionCell: {
    fontFamily,
    fontSize: 15,
    color: TEXT,
    fontVariant: ['tabular-nums'],
    letterSpacing: -0.2,
  },
  bAccent: {
    width: 3,
    alignSelf: 'stretch',
    minHeight: 28,
    borderRadius: 2,
    marginLeft: 8,
    flexShrink: 0,
  },
  bColItem: {
    width: 260,
    flexShrink: 0,
    paddingRight: 4,
    ...Platform.select({
      web: { width: '100%' },
      default: {},
    }),
  },
  bItemCell: {
    justifyContent: 'flex-start',
    gap: 6,
    paddingTop: 2,
  },
  bItemName: {
    fontFamily: FONT_LIGHT,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '400',
    color: TEXT,
    letterSpacing: -0.2,
  },
  bItemSku: {
    fontFamily,
    fontSize: 12,
    color: SECONDARY,
    letterSpacing: -0.08,
  },
  bHistInline: {
    flexDirection: 'row',
    alignItems: 'stretch',
    marginTop: 2,
    borderRadius: 8,
    backgroundColor: FILL,
    overflow: 'hidden',
    alignSelf: 'stretch',
  },
  bHistInlineCell: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 4,
    paddingHorizontal: 4,
    alignItems: 'center',
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: HAIRLINE,
  },
  bHistInlineLabel: {
    fontFamily,
    fontSize: 10,
    fontWeight: '500',
    color: SECONDARY,
    letterSpacing: -0.08,
  },
  bHistInlineValue: {
    fontFamily,
    fontSize: 12,
    fontWeight: '600',
    color: TEXT,
    fontVariant: ['tabular-nums'],
    letterSpacing: -0.08,
  },
  bHistCard: {
    flexDirection: 'row',
    alignItems: 'stretch',
    width: '100%',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ececef',
    backgroundColor: FILL,
  },
  bHistCardCell: {
    flex: 1,
    alignItems: 'center',
    minWidth: 0,
    paddingVertical: 12,
    gap: 2,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: HAIRLINE,
  },
  bHistCellLast: {
    borderRightWidth: 0,
  },
  bHistCardLabel: {
    fontFamily,
    fontSize: 11,
    fontWeight: '600',
    color: SECONDARY,
    letterSpacing: -0.08,
  },
  bHistCardValue: {
    fontFamily,
    fontSize: 17,
    fontWeight: '600',
    color: TEXT,
    fontVariant: ['tabular-nums'],
    letterSpacing: -0.3,
  },
  bColNum: {
    width: 72,
    flexShrink: 0,
    ...Platform.select({
      web: { width: '100%' },
      default: {},
    }),
  },
  bNumCell: {
    alignItems: 'flex-end',
    justifyContent: 'flex-start',
    paddingTop: 10,
  },
  bSystemCell: {
    fontWeight: '600',
    fontSize: 17,
    textAlign: 'right',
  },
  bTotalCell: {
    fontWeight: '600',
    fontSize: 17,
    textAlign: 'right',
  },
  bColInput: {
    width: 100,
    flexShrink: 0,
    minWidth: 0,
    ...Platform.select({
      web: { width: '100%' },
      default: {},
    }),
  },
  bColResult: {
    width: 88,
    flexShrink: 0,
    alignItems: 'flex-end',
    justifyContent: 'flex-start',
    gap: 4,
    paddingTop: 8,
    minWidth: 0,
    ...Platform.select({
      web: { width: '100%' },
      default: {},
    }),
  },
  bInput: {
    width: '100%',
    borderWidth: 0,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 10,
    fontFamily,
    fontSize: 17,
    fontWeight: '500',
    color: TEXT,
    backgroundColor: FILL,
    fontVariant: ['tabular-nums'],
    textAlign: 'center',
    minHeight: 44,
    ...Platform.select({
      web: { outlineStyle: 'none', cursor: 'text', boxSizing: 'border-box' },
      default: {},
    }),
  },
  bInputDense: {
    minHeight: 40,
    fontSize: 15,
    paddingVertical: 6,
    borderRadius: 10,
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
  bInputPlain: {
    minHeight: 48,
    fontSize: 17,
    fontWeight: '600',
    textAlign: 'right',
    backgroundColor: 'transparent',
    paddingHorizontal: 0,
    paddingVertical: 10,
    borderRadius: 0,
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
  bMobileHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 10,
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
  bMobileCardOff: {
    borderColor: 'rgba(255, 59, 48, 0.35)',
    backgroundColor: 'rgba(255, 59, 48, 0.04)',
  },
  bMobileStats: {
    flexDirection: 'row',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ececef',
  },
  bMobileStat: {
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: '#ececef',
    gap: 2,
  },
  bMobileStatLast: {
    borderRightWidth: 0,
  },
  bMobileStatLabel: {
    fontFamily,
    fontSize: 12,
    fontWeight: '500',
    color: SECONDARY,
    letterSpacing: -0.08,
  },
  bMobileStatValue: {
    fontFamily,
    fontSize: 22,
    fontWeight: '600',
    color: TEXT,
    fontVariant: ['tabular-nums'],
    letterSpacing: -0.4,
  },
  bMobileActions: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#ececef',
  },
  bMobileSave: {
    flex: 1,
    minHeight: 48,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: ACCENT,
    backgroundColor: TINT,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  bMobileSaveText: {
    fontFamily,
    fontSize: 17,
    fontWeight: '600',
    color: ACCENT,
  },
  bMobileUpdate: {
    flex: 1,
    minHeight: 48,
    borderRadius: 12,
    backgroundColor: ACCENT,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  bMobileUpdateText: {
    fontFamily,
    fontSize: 17,
    fontWeight: '600',
    color: '#fff',
  },
  bColAction: {
    width: 88,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 6,
    flexShrink: 0,
    paddingTop: 4,
    ...Platform.select({
      web: { width: '100%' },
      default: {},
    }),
  },
  bSaveButton: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: FILL,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  bUpdateButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: ACCENT,
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
  filterSelect: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 32,
    minHeight: 32,
    paddingHorizontal: 10,
    borderRadius: NAV_TAB_ACTIVE_RADIUS,
    borderWidth: 1,
    borderColor: TAB_BORDER,
    backgroundColor: PAGE,
    ...CHIP_SHADOW,
    maxWidth: 160,
    flexShrink: 1,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
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
    backgroundColor: PAGE,
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    maxHeight: '70%',
    paddingBottom: Platform.OS === 'ios' ? Math.max(20, mobileSafeBottom()) : 16,
  },
  filterModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 10,
    backgroundColor: '#fff',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: HAIRLINE,
  },
  filterModalTitle: {
    fontFamily,
    fontSize: 17,
    fontWeight: '600',
    color: TEXT,
    letterSpacing: -0.3,
  },
  filterModalList: {
    maxHeight: 360,
    backgroundColor: CARD,
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 8,
    borderRadius: 12,
    overflow: 'hidden',
  },
  filterModalOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    minHeight: 44,
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: HAIRLINE,
  },
  filterModalOptionActive: {
    backgroundColor: CARD,
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
    color: ACCENT,
  },
  aiRowMobile: {
    flexDirection: 'column',
    alignItems: 'stretch',
  },
  rangePresetRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ececef',
  },
  rangeDatePick: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  rangeDateCaption: {
    fontFamily,
    fontSize: 13,
    color: SECONDARY,
    letterSpacing: -0.1,
  },
  rangePreset: {
    borderRadius: NAV_TAB_ACTIVE_RADIUS,
    borderWidth: 1,
    borderColor: TAB_BORDER,
    backgroundColor: PAGE,
    paddingHorizontal: 10,
    height: 28,
    justifyContent: 'center',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  rangePresetActive: {
    backgroundColor: TINT,
    borderColor: ACCENT,
  },
  rangePresetText: {
    fontFamily,
    fontSize: 13,
    color: TEXT,
    letterSpacing: -0.1,
  },
  rangePresetTextActive: {
    color: ACCENT,
    fontWeight: '600',
  },
  rangeHint: {
    fontFamily,
    fontSize: 12,
    color: SECONDARY,
    marginLeft: 'auto',
  },
  rangeDescription: {
    fontFamily: FONT_LIGHT,
    flex: 1,
    minWidth: 220,
    fontSize: 13,
    lineHeight: 18,
    color: SECONDARY,
    letterSpacing: -0.1,
  },
  rangeDescriptionMobile: {
    minWidth: 0,
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
  ticketCard: {
    borderWidth: 1,
    borderColor: TAB_BORDER,
    borderRadius: NAV_TAB_ACTIVE_RADIUS,
    backgroundColor: PAGE,
    overflow: 'hidden',
    width: '100%',
    ...TICKET_SHADOW,
  },
  ticketFieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
    paddingHorizontal: 14,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ececef',
  },
  ticketFieldRowLast: {
    borderBottomWidth: 0,
  },
  ticketFieldLabel: {
    fontFamily,
    width: 82,
    flexShrink: 0,
    fontSize: 13,
    fontWeight: '500',
    color: SECONDARY,
  },
  ticketFieldControl: {
    flex: 1,
    minWidth: 0,
    alignItems: 'stretch',
  },
  ticketFieldValue: {
    fontFamily,
    fontSize: 15,
    color: TEXT,
    textAlign: 'right',
    paddingVertical: 8,
    fontVariant: ['tabular-nums'],
  },
  ticketFieldInline: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 10,
    minHeight: 44,
  },
  ticketToday: {
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: TEXT,
  },
  ticketSearchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 44,
  },
  ticketSearchInput: {
    flex: 1,
    minWidth: 0,
    fontFamily,
    fontSize: 15,
    color: TEXT,
    textAlign: 'right',
    paddingVertical: 8,
    ...Platform.select({
      web: { outlineStyle: 'none' },
      default: {},
    }),
  },
  ticketToggleHit: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 6,
    minHeight: 44,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  filterSelectPlain: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 6,
    minHeight: 44,
    backgroundColor: 'transparent',
    paddingHorizontal: 0,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  filterSelectPlainFill: {
    maxWidth: '100%',
    width: '100%',
    minWidth: 0,
  },
  filterSelectValuePlain: {
    fontSize: 15,
    textAlign: 'right',
  },
  dateChipPlain: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 6,
    minHeight: 44,
    flex: 1,
    minWidth: 0,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  stickyBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingTop: 10,
    paddingBottom: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: HAIRLINE,
    backgroundColor: PAGE,
  },
  stickyBarEmbedded: {
    paddingBottom: Math.max(12, mobileSafeBottom()),
  },
  cashMobileToolbar: {
    gap: 10,
    marginTop: 2,
    marginBottom: 8,
    width: '100%',
  },
});
