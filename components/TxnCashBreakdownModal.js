import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
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
  bumpCountText,
  denomsForCurrency,
  denomTitle,
  parseCount,
  splitCashDenoms,
} from '../lib/cashDenoms';
import {
  fetchTransactionDetail,
  formatAmount,
  needsTxnCashEnrichment,
  resolvePosAuthForRow,
  txnCashAmount,
  txnCashCurrency,
  withPaymentBreakdown,
} from '../lib/transactions';
import {
  cashBreakdownKey,
  countsHaveValues,
  emptyBreakdownSheet,
  loadTxnCashBreakdowns,
  netFromSides,
  saveTxnCashBreakdown,
} from '../lib/txnCashBreakdowns';

const fontFamily = Platform.select({
  ios: 'Sohne',
  android: 'Sohne',
  default: 'Sohne',
});

const TEXT = '#1d1d1f';
const SECONDARY = '#8e8e93';
const GREEN = '#2F8A4E';
const RED = '#FF3B30';
const FILL = 'rgba(118, 118, 128, 0.12)';
const HAIRLINE = '#e5e5ea';

function moneyClose(a, b) {
  if (a == null || b == null) return false;
  return Math.abs(Number(a) - Number(b)) < 0.009;
}

function roundMoney(value) {
  return Math.round(Number(value) * 100) / 100;
}

function signedAmount(value, currency) {
  const n = roundMoney(value);
  const label = formatAmount(Math.abs(n), currency);
  if (n > 0) return `+${label}`;
  if (n < 0) return `−${label}`;
  return label;
}

function Stepper({ value, onChange, label }) {
  const n = parseCount(value) ?? 0;
  return (
    <View style={styles.stepper}>
      <Pressable
        onPress={() => onChange(bumpCountText(value, -1))}
        disabled={n <= 0}
        hitSlop={4}
        accessibilityRole="button"
        accessibilityLabel={`Decrease ${label}`}
        style={({ pressed }) => [
          styles.stepBtn,
          n <= 0 && styles.stepBtnDisabled,
          pressed && n > 0 && styles.stepBtnPressed,
        ]}
      >
        <Ionicons name="remove" size={14} color={n <= 0 ? '#c7c7cc' : TEXT} />
      </Pressable>
      <TextInput
        value={value}
        onChangeText={onChange}
        keyboardType="number-pad"
        inputMode="numeric"
        placeholder="0"
        placeholderTextColor="#c7c7cc"
        selectTextOnFocus
        autoCorrect={false}
        accessibilityLabel={label}
        style={styles.stepInput}
      />
      <Pressable
        onPress={() => onChange(bumpCountText(value, 1))}
        hitSlop={4}
        accessibilityRole="button"
        accessibilityLabel={`Increase ${label}`}
        style={({ pressed }) => [styles.stepBtn, pressed && styles.stepBtnPressed]}
      >
        <Ionicons name="add" size={14} color={TEXT} />
      </Pressable>
    </View>
  );
}

export function TxnCashIcon({ saved, onPress, accessibilityLabel }) {
  return (
    <Pressable
      onPress={(event) => {
        event?.stopPropagation?.();
        if (typeof event?.preventDefault === 'function') event.preventDefault();
        onPress?.();
      }}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={
        accessibilityLabel || (saved ? 'Edit cash bill breakdown' : 'Add cash bill breakdown')
      }
      style={({ hovered, pressed }) => [
        styles.iconBtn,
        (hovered || pressed) && styles.iconBtnActive,
      ]}
    >
      <Ionicons name={saved ? 'cash' : 'cash-outline'} size={16} color={saved ? GREEN : SECONDARY} />
    </Pressable>
  );
}

export default function TxnCashBreakdownModal({
  visible,
  session,
  row,
  initialSheet,
  onClose,
  onSaved,
}) {
  const [enrichedRow, setEnrichedRow] = useState(row);
  const activeRow = enrichedRow || row;
  const currency = txnCashCurrency(activeRow);
  const denoms = denomsForCurrency(currency);
  const cashAmount = txnCashAmount(activeRow);
  const inbound = activeRow?.kind === 'cash_transaction'
    ? activeRow?.type === 'In'
    : activeRow?.type === 'purchase' || activeRow?.type === 'Out'
      ? false
      : true;

  const [received, setReceived] = useState(() => emptyBreakdownSheet(currency).received);
  const [given, setGiven] = useState(() => emptyBreakdownSheet(currency).given);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!visible || !row) {
      setEnrichedRow(null);
      return undefined;
    }
    setEnrichedRow(row);
    const seed = initialSheet?.hasCount ? initialSheet : null;
    const empty = emptyBreakdownSheet(txnCashCurrency(row));
    setReceived(seed?.received || empty.received);
    setGiven(seed?.given || empty.given);
    setError('');
    setSaving(false);

    let cancelled = false;
    const key = cashBreakdownKey(row);
    if (!key) return undefined;
    setLoading(true);

    const loadSheet = loadTxnCashBreakdowns([key])
      .then((map) => {
        if (cancelled) return;
        const sheet = map[key];
        if (sheet?.hasCount) {
          setReceived(sheet.received);
          setGiven(sheet.given);
        }
      });

    const loadAureus = needsTxnCashEnrichment(row)
      ? (async () => {
          const auth = resolvePosAuthForRow(session, row);
          if (!auth?.token || !row.sourceId) return;
          const detail = await fetchTransactionDetail(auth.token, {
            type: row.type,
            sourceId: row.sourceId,
            baseUrl: auth.baseUrl,
          });
          if (cancelled) return;
          setEnrichedRow(withPaymentBreakdown(row, detail));
        })().catch((err) => {
          if (!cancelled) {
            setError(err?.message || 'Could not load Aureus payment split.');
          }
        })
      : Promise.resolve();

    Promise.all([loadSheet, loadAureus])
      .catch((err) => {
        if (!cancelled) setError(err?.message || 'Could not load breakdown.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [visible, row, session]);

  const net = useMemo(() => netFromSides(received, given, denoms), [received, given, denoms]);
  const expected = cashAmount == null ? null : inbound ? cashAmount : -cashAmount;
  const delta = expected == null ? null : roundMoney(net - expected);
  const hasCount = countsHaveValues(received) || countsHaveValues(given);
  const matches = expected != null && hasCount && moneyClose(net, expected);
  const { bills, coins } = splitCashDenoms(denoms);
  const groups = [
    bills.length ? { key: 'bills', title: 'Bills', denoms: bills } : null,
    coins.length ? { key: 'coins', title: 'Coins', denoms: coins } : null,
  ].filter(Boolean);

  const title = inbound ? 'Cash received' : 'Cash given';
  const aureusLabel = activeRow?.paymentBreakdownLabel || '';
  const hasSplit =
    Array.isArray(activeRow?.paymentBreakdown) && activeRow.paymentBreakdown.length > 1;
  const subtitle = [
    activeRow?.reference,
    activeRow?.customerName,
    aureusLabel || (cashAmount != null ? formatAmount(cashAmount, currency) : activeRow?.amountLabel),
  ]
    .filter((part) => part && part !== '—')
    .join(' · ');

  const handleSave = async () => {
    if (!row) return;
    setSaving(true);
    setError('');
    try {
      const saved = await saveTxnCashBreakdown(activeRow || row, {
        currency,
        received,
        given,
        cashAmount,
      });
      onSaved?.(saved);
    } catch (err) {
      setError(err?.message || 'Could not save breakdown.');
      setSaving(false);
    }
  };

  const handleClear = async () => {
    if (!row) return;
    setSaving(true);
    setError('');
    try {
      const empty = emptyBreakdownSheet(currency);
      const saved = await saveTxnCashBreakdown(activeRow || row, empty);
      onSaved?.(saved);
    } catch (err) {
      setError(err?.message || 'Could not clear breakdown.');
      setSaving(false);
    }
  };

  if (!visible || !row) return null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.header}>
            <View style={styles.headerCopy}>
              <Text style={styles.title}>{title}</Text>
              {subtitle ? (
                <Text style={styles.subtitle} numberOfLines={2}>
                  {subtitle}
                </Text>
              ) : null}
            </View>
            <Pressable onPress={onClose} hitSlop={8} accessibilityLabel="Close">
              <Ionicons name="close" size={20} color={SECONDARY} />
            </Pressable>
          </View>

          <Text style={styles.hint}>
            {hasSplit && cashAmount != null
              ? `Aureus cash is ${formatAmount(cashAmount, currency)}. Check, debit, and draft are left out.`
              : inbound
                ? 'Bills the customer handed you, and change you gave back.'
                : 'Bills you handed the customer, and any cash they gave back.'}
          </Text>

          <View style={styles.colHead}>
            <Text style={styles.colHeadFace}> </Text>
            <Text style={styles.colHeadSide}>In</Text>
            <Text style={styles.colHeadSide}>Out</Text>
          </View>

          {loading ? (
            <View style={styles.loading}>
              <ActivityIndicator color={TEXT} />
            </View>
          ) : (
            <ScrollView
              style={styles.list}
              contentContainerStyle={styles.listContent}
              keyboardShouldPersistTaps="handled"
            >
              {groups.map((group) => (
                <View key={group.key}>
                  {groups.length > 1 ? <Text style={styles.groupTitle}>{group.title}</Text> : null}
                  {group.denoms.map((denom) => (
                    <View key={denom.key} style={styles.denomRow}>
                      <View style={styles.denomLabel}>
                        <View style={[styles.denomDot, { backgroundColor: denom.color }]} />
                        <Text style={styles.denomFace}>{denomTitle(denom)}</Text>
                      </View>
                      <Stepper
                        value={received[denom.key]}
                        onChange={(value) =>
                          setReceived((current) => ({ ...current, [denom.key]: value }))
                        }
                        label={`${denomTitle(denom)} received`}
                      />
                      <Stepper
                        value={given[denom.key]}
                        onChange={(value) =>
                          setGiven((current) => ({ ...current, [denom.key]: value }))
                        }
                        label={`${denomTitle(denom)} given`}
                      />
                    </View>
                  ))}
                </View>
              ))}
            </ScrollView>
          )}

          <View style={styles.footer}>
            <View style={styles.footerCopy}>
              <Text style={styles.netLabel}>
                Net {signedAmount(net, currency)}
                {cashAmount != null ? `  ·  amount ${formatAmount(cashAmount, currency)}` : ''}
              </Text>
              {hasCount && delta != null ? (
                <Text style={[styles.netLabel, matches ? styles.matchOk : styles.matchOff]}>
                  Difference {signedAmount(delta, currency)}
                </Text>
              ) : null}
              {hasSplit && aureusLabel ? (
                <Text style={styles.match}>{aureusLabel}</Text>
              ) : null}
              {hasCount ? (
                <Text style={[styles.match, matches ? styles.matchOk : styles.matchOff]}>
                  {matches ? 'Matches cash amount' : 'Does not match cash amount'}
                </Text>
              ) : (
                <Text style={styles.match}>Leave empty to clear a saved slip</Text>
              )}
              {error ? <Text style={styles.error}>{error}</Text> : null}
            </View>
            <View style={styles.footerActions}>
              {initialSheet?.hasCount ? (
                <Pressable onPress={handleClear} disabled={saving} hitSlop={6}>
                  <Text style={styles.clearText}>Clear</Text>
                </Pressable>
              ) : null}
              <Pressable
                onPress={handleSave}
                disabled={saving}
                style={({ pressed }) => [styles.saveBtn, pressed && styles.saveBtnPressed]}
              >
                {saving ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.saveText}>Save</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  iconBtn: {
    width: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 11,
  },
  iconBtnActive: {
    backgroundColor: FILL,
  },
  root: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.28)',
  },
  sheet: {
    width: '100%',
    maxWidth: 420,
    maxHeight: '88%',
    backgroundColor: '#fff',
    borderRadius: 16,
    overflow: 'hidden',
    ...Platform.select({
      web: { boxShadow: '0 16px 48px rgba(0,0,0,0.18)' },
      default: {
        shadowColor: '#000',
        shadowOpacity: 0.18,
        shadowRadius: 24,
        shadowOffset: { width: 0, height: 10 },
        elevation: 8,
      },
    }),
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 6,
  },
  headerCopy: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontFamily,
    fontSize: 17,
    fontWeight: '600',
    color: TEXT,
    letterSpacing: -0.3,
  },
  subtitle: {
    fontFamily,
    fontSize: 13,
    color: SECONDARY,
    letterSpacing: -0.08,
    marginTop: 2,
  },
  hint: {
    fontFamily,
    fontSize: 12,
    color: SECONDARY,
    letterSpacing: -0.08,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  colHead: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 4,
    gap: 8,
  },
  colHeadFace: {
    width: 64,
  },
  colHeadSide: {
    flex: 1,
    fontFamily,
    fontSize: 11,
    fontWeight: '600',
    color: SECONDARY,
    textAlign: 'center',
    letterSpacing: 0.2,
    textTransform: 'uppercase',
  },
  loading: {
    minHeight: 120,
    alignItems: 'center',
    justifyContent: 'center',
  },
  list: {
    maxHeight: 360,
  },
  listContent: {
    paddingHorizontal: 12,
    paddingBottom: 8,
  },
  groupTitle: {
    fontFamily,
    fontSize: 11,
    fontWeight: '600',
    color: SECONDARY,
    letterSpacing: 0.2,
    textTransform: 'uppercase',
    paddingHorizontal: 4,
    paddingTop: 8,
    paddingBottom: 4,
  },
  denomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 4,
    paddingHorizontal: 4,
  },
  denomLabel: {
    width: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  denomDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  denomFace: {
    fontFamily,
    fontSize: 14,
    fontWeight: '600',
    color: TEXT,
    letterSpacing: -0.2,
  },
  stepper: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f2f2f7',
    borderRadius: 10,
    overflow: 'hidden',
  },
  stepBtn: {
    width: 28,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBtnDisabled: {
    opacity: 0.45,
  },
  stepBtnPressed: {
    backgroundColor: FILL,
  },
  stepInput: {
    flex: 1,
    minWidth: 0,
    height: 32,
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: TEXT,
    textAlign: 'center',
    paddingVertical: 0,
    ...Platform.select({
      web: { outlineStyle: 'none' },
      default: {},
    }),
  },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: HAIRLINE,
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 10,
  },
  footerCopy: {
    gap: 2,
  },
  netLabel: {
    fontFamily,
    fontSize: 14,
    fontWeight: '600',
    color: TEXT,
    letterSpacing: -0.2,
    fontVariant: ['tabular-nums'],
  },
  match: {
    fontFamily,
    fontSize: 12,
    color: SECONDARY,
    letterSpacing: -0.08,
  },
  matchOk: {
    color: GREEN,
  },
  matchOff: {
    color: RED,
  },
  error: {
    fontFamily,
    fontSize: 12,
    color: RED,
    marginTop: 4,
  },
  footerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 14,
  },
  clearText: {
    fontFamily,
    fontSize: 15,
    color: SECONDARY,
  },
  saveBtn: {
    backgroundColor: GREEN,
    borderRadius: 10,
    paddingHorizontal: 16,
    minWidth: 72,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnPressed: {
    opacity: 0.88,
  },
  saveText: {
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
  },
});
