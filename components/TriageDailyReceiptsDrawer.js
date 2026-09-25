import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { EmptyState, FONT, InlineNotice, ProgressBar, StatusPill, T, TONES, TriageDrawer } from './TriageKit';
import { useIsMobile } from '../lib/mobileUi';
import {
  buildDailyReceiptGrid,
  dailyCellKey,
  dailyReceiptStatus,
  saveDailyReceipts,
  summarizeDailyReceipts,
} from '../lib/triageDailyReceipts';

const DAY_COL = 132;
const STORE_COL = 124;
const TOTAL_COL = 104;

function parseCount(text) {
  const trimmed = String(text ?? '').trim();
  if (!trimmed) return null;
  const n = Math.round(Number(trimmed));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function actorNameOf(session) {
  if (!session) return '';
  if (session.profile?.fullName) return session.profile.fullName;
  const user = session.user;
  const parts = [user?.first_name, user?.last_name].filter(Boolean).join(' ').trim();
  return parts || user?.name || user?.full_name || session.login || '';
}

function cellTone(expected, received) {
  if (received == null) return null;
  if (received < expected) return 'red';
  if (received > expected) return 'orange';
  return 'green';
}

/** Read-only stacked fraction: received over expected. */
function Fraction({ received, expected, tone, large = false, width }) {
  const color = tone ? TONES[tone].fg : null;
  return (
    <View style={[styles.fraction, width != null && { width }]}>
      <Text
        style={[styles.fractionTop, large && styles.fractionTopLarge, color && { color }]}
        numberOfLines={1}
      >
        {received == null ? '—' : received}
      </Text>
      <View style={[styles.fractionLine, color && { backgroundColor: color }]} />
      <Text style={[styles.fractionBottom, large && styles.fractionBottomLarge]} numberOfLines={1}>
        {expected}
      </Text>
    </View>
  );
}

/** Editable fraction: the Workshop types the numerator, the store's logged count is the denominator. */
function CountCell({ expected, value, onChange, label }) {
  const received = parseCount(value);
  const inputRef = useRef(null);
  const [focused, setFocused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const tone = cellTone(expected, received);
  const colors = tone ? TONES[tone] : null;
  const idle = expected === 0 && received == null;
  return (
    <View style={[styles.cell, { width: STORE_COL }]}>
      <Pressable
        onHoverIn={() => setHovered(true)}
        onHoverOut={() => setHovered(false)}
        onPressIn={() => inputRef.current?.focus?.()}
        focusable={false}
        style={[
          styles.cellBox,
          colors && { borderColor: colors.fg, backgroundColor: colors.bg },
          idle && styles.cellBoxIdle,
          hovered && !focused && styles.cellBoxHover,
          focused && styles.cellBoxFocused,
        ]}
        accessible={false}
      >
        <TextInput
          ref={inputRef}
          style={[styles.cellInput, colors && { color: colors.fg }]}
          value={value}
          onChangeText={onChange}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder="—"
          placeholderTextColor={T.tertiary}
          keyboardType="number-pad"
          inputMode="numeric"
          selectTextOnFocus
          maxLength={4}
          accessibilityLabel={label}
        />
        <View style={[styles.fractionLine, styles.cellLine, colors && { backgroundColor: colors.fg }]} />
        <Text style={[styles.cellExpected, colors && { color: colors.fg }]} numberOfLines={1}>
          {expected}
        </Text>
      </Pressable>
    </View>
  );
}

export default function TriageDailyReceiptsDrawer({
  visible,
  onClose,
  batch,
  session,
  receipts,
  loading = false,
  loadError = '',
  onSaved,
}) {
  const isMobile = useIsMobile();
  const [edits, setEdits] = useState({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [savedAt, setSavedAt] = useState(0);

  const grid = useMemo(() => buildDailyReceiptGrid(batch), [batch]);

  useEffect(() => {
    if (visible) return;
    setEdits({});
    setSaveError('');
    setSavedAt(0);
  }, [visible]);

  const valueFor = useCallback(
    (cell) => {
      if (Object.prototype.hasOwnProperty.call(edits, cell)) return edits[cell];
      const saved = receipts?.[cell]?.received;
      return saved == null ? '' : String(saved);
    },
    [edits, receipts],
  );

  const draftReceipts = useMemo(() => {
    const next = { ...(receipts || {}) };
    for (const [cell, text] of Object.entries(edits)) {
      next[cell] = { ...(next[cell] || {}), received: parseCount(text) };
    }
    return next;
  }, [edits, receipts]);

  const summary = useMemo(() => summarizeDailyReceipts(grid, draftReceipts), [draftReceipts, grid]);
  const savedSummary = useMemo(() => summarizeDailyReceipts(grid, receipts), [grid, receipts]);
  const status = dailyReceiptStatus(savedSummary);

  const dirtyEntries = useMemo(() => {
    const list = [];
    const storeByKey = new Map(grid.stores.map((store) => [store.key, store]));
    for (const [cell, text] of Object.entries(edits)) {
      const [dayKey, storeKey] = cell.split('|');
      if (!dayKey || !storeKey || !storeByKey.has(storeKey)) continue;
      const next = parseCount(text);
      const saved = receipts?.[cell]?.received ?? null;
      const expected = grid.expected[cell] || 0;
      const savedExpected = receipts?.[cell]?.expected;
      if (next === saved && (savedExpected == null || savedExpected === expected)) continue;
      list.push({ dayKey, storeKey, storeName: storeByKey.get(storeKey).name, expected, received: next });
    }
    return list;
  }, [edits, grid, receipts]);

  const dirty = dirtyEntries.length > 0;

  const setCell = useCallback((cell, text) => {
    const clean = String(text ?? '').replace(/[^0-9]/g, '');
    setEdits((prev) => ({ ...prev, [cell]: clean }));
    setSaveError('');
    setSavedAt(0);
  }, []);

  const save = useCallback(async () => {
    if (!dirty || saving) return;
    setSaving(true);
    setSaveError('');
    try {
      await saveDailyReceipts(grid.batchId, dirtyEntries, actorNameOf(session));
      setEdits({});
      setSavedAt(Date.now());
      await onSaved?.();
    } catch (err) {
      setSaveError(err?.message || 'Could not save the daily check.');
    } finally {
      setSaving(false);
    }
  }, [dirty, dirtyEntries, grid.batchId, onSaved, saving, session]);

  const storeTotals = useMemo(() => {
    const totals = new Map();
    for (const store of grid.stores) totals.set(store.key, { expected: 0, received: 0, entered: false });
    for (const day of grid.days) {
      for (const store of grid.stores) {
        const cell = dailyCellKey(day.key, store.key);
        const row = totals.get(store.key);
        row.expected += grid.expected[cell] || 0;
        const received = parseCount(valueFor(cell));
        if (received != null) {
          row.received += received;
          row.entered = true;
        }
      }
    }
    return totals;
  }, [grid, valueFor]);

  const stores = grid.stores;
  const days = grid.days;
  const empty = stores.length === 0 || days.length === 0;
  const tableWidth = DAY_COL + STORE_COL * stores.length + TOTAL_COL;

  return (
    <TriageDrawer
      visible={visible}
      onClose={onClose}
      title="Daily check"
      subtitle={batch?.dateLabel ? `${batch.dateLabel} · ${stores.length} ${stores.length === 1 ? 'store' : 'stores'}` : ''}
      leftLabel="Done"
      onLeft={onClose}
      rightLabel={saving ? 'Saving…' : 'Update'}
      onRight={save}
      rightDisabled={!dirty || saving}
      widthRatio={0.72}
      minWidth={760}
    >
      <ScrollView
        style={styles.body}
        contentContainerStyle={[styles.content, isMobile && styles.contentMobile]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.hero}>
          <Text style={styles.heroLabel}>Received</Text>
          <View style={styles.heroRow}>
            <Text style={styles.heroValue}>
              {summary.totalReceived}
              <Text style={styles.heroOf}> / {summary.totalExpected}</Text>
            </Text>
            <StatusPill label={status.value} tone={status.tone || 'neutral'} />
          </View>
          <Text style={styles.heroMeta}>
            {summary.cells
              ? `${summary.checked} of ${summary.cells} store-days checked`
              : 'No PO / SO logged on this batch yet'}
            {summary.short ? ` · ${summary.short} short` : ''}
            {summary.over ? ` · ${summary.over} extra` : ''}
            {dirty ? ' · unsaved changes' : ''}
          </Text>
          <ProgressBar
            value={summary.totalReceived}
            total={summary.totalExpected}
            tone={summary.short ? 'red' : 'green'}
            height={6}
            style={styles.heroBar}
          />
        </View>

        {loadError ? (
          <InlineNotice tone="red" icon="alert-circle-outline" style={styles.notice}>
            {loadError}
          </InlineNotice>
        ) : null}

        {empty ? (
          <EmptyState
            icon="calendar-outline"
            title="Nothing to check yet"
            body="Add stores and PO / SO to this batch first. Each day and store will show up here."
          />
        ) : isMobile ? (
          <View style={styles.mobileDays}>
            {days.map((day) => {
              let rowExpected = 0;
              let rowReceived = 0;
              let rowEntered = false;
              for (const store of stores) {
                const cell = dailyCellKey(day.key, store.key);
                rowExpected += grid.expected[cell] || 0;
                const received = parseCount(valueFor(cell));
                if (received != null) {
                  rowReceived += received;
                  rowEntered = true;
                }
              }
              const rowTone = rowEntered ? cellTone(rowExpected, rowReceived) : null;
              return (
                <View key={day.key} style={styles.mobileDayCard}>
                  <View style={styles.mobileDayHead}>
                    <View>
                      <Text style={styles.dayWeekday}>{day.weekday}</Text>
                      <Text style={styles.dayLabel}>{day.label}</Text>
                    </View>
                    <Fraction received={rowEntered ? rowReceived : null} expected={rowExpected} tone={rowTone} />
                  </View>
                  {stores.map((store, storeIndex) => {
                    const cell = dailyCellKey(day.key, store.key);
                    return (
                      <View
                        key={cell}
                        style={[styles.mobileStoreRow, storeIndex === stores.length - 1 && styles.mobileStoreRowLast]}
                      >
                        <Text style={styles.mobileStoreName} numberOfLines={1}>
                          {store.name}
                        </Text>
                        <CountCell
                          expected={grid.expected[cell] || 0}
                          value={valueFor(cell)}
                          onChange={(text) => setCell(cell, text)}
                          label={`${store.name} received on ${day.label}`}
                        />
                      </View>
                    );
                  })}
                </View>
              );
            })}
            <View style={styles.mobileDayCard}>
              <Text style={styles.mobileAllLabel}>All days</Text>
              {stores.map((store, storeIndex) => {
                const total = storeTotals.get(store.key);
                const tone = total.entered ? cellTone(total.expected, total.received) : null;
                return (
                  <View
                    key={store.key}
                    style={[styles.mobileStoreRow, storeIndex === stores.length - 1 && styles.mobileStoreRowLast]}
                  >
                    <Text style={styles.mobileStoreName} numberOfLines={1}>
                      {store.name}
                    </Text>
                    <Fraction received={total.entered ? total.received : null} expected={total.expected} tone={tone} />
                  </View>
                );
              })}
            </View>
          </View>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={Platform.OS === 'web'} style={styles.tableScroll}>
            <View style={[styles.table, { width: tableWidth }]}>
              <View style={[styles.row, styles.headRow]}>
                <View style={[styles.headCell, { width: DAY_COL }]}>
                  <Text style={styles.headText}>Day</Text>
                  <Text style={styles.headSub} numberOfLines={1}>
                    received / expected
                  </Text>
                </View>
                {stores.map((store) => {
                  const total = storeTotals.get(store.key);
                  return (
                    <View key={store.key} style={[styles.headCell, styles.headStore, { width: STORE_COL }]}>
                      <Text style={[styles.headText, styles.headStoreText]} numberOfLines={2}>
                        {store.name}
                      </Text>
                      <Text style={styles.headSub} numberOfLines={1}>
                        {total.expected} expected
                      </Text>
                    </View>
                  );
                })}
                <View style={[styles.headCell, styles.headTotal, { width: TOTAL_COL }]}>
                  <Text style={[styles.headText, styles.headTotalText]}>Total</Text>
                </View>
              </View>

              {days.map((day, index) => {
                let rowExpected = 0;
                let rowReceived = 0;
                let rowEntered = false;
                for (const store of stores) {
                  const cell = dailyCellKey(day.key, store.key);
                  rowExpected += grid.expected[cell] || 0;
                  const received = parseCount(valueFor(cell));
                  if (received != null) {
                    rowReceived += received;
                    rowEntered = true;
                  }
                }
                const rowTone = rowEntered ? cellTone(rowExpected, rowReceived) : null;
                return (
                  <View key={day.key} style={[styles.row, index === days.length - 1 && styles.rowLast]}>
                    <View style={[styles.dayCell, { width: DAY_COL }]}>
                      <Text style={styles.dayWeekday}>{day.weekday}</Text>
                      <Text style={styles.dayLabel}>{day.label}</Text>
                    </View>
                    {stores.map((store) => {
                      const cell = dailyCellKey(day.key, store.key);
                      return (
                        <CountCell
                          key={cell}
                          expected={grid.expected[cell] || 0}
                          value={valueFor(cell)}
                          onChange={(text) => setCell(cell, text)}
                          label={`${store.name} received on ${day.label}`}
                        />
                      );
                    })}
                    <View style={[styles.totalCell, { width: TOTAL_COL }]}>
                      <Fraction received={rowEntered ? rowReceived : null} expected={rowExpected} tone={rowTone} />
                    </View>
                  </View>
                );
              })}

              <View style={[styles.row, styles.footRow]}>
                <Text style={[styles.footLabel, { width: DAY_COL }]}>All days</Text>
                {stores.map((store) => {
                  const total = storeTotals.get(store.key);
                  const tone = total.entered ? cellTone(total.expected, total.received) : null;
                  return (
                    <View key={store.key} style={[styles.totalCell, styles.totalCellCentered, { width: STORE_COL }]}>
                      <Fraction received={total.entered ? total.received : null} expected={total.expected} tone={tone} />
                    </View>
                  );
                })}
                <View style={[styles.totalCell, { width: TOTAL_COL }]}>
                  <Fraction
                    received={summary.checked > 0 ? summary.totalReceived : null}
                    expected={summary.totalExpected}
                    tone={
                      summary.checked > 0 && summary.short
                        ? 'red'
                        : summary.checked > 0 && summary.totalReceived > 0
                          ? 'green'
                          : null
                    }
                    large
                  />
                </View>
              </View>
            </View>
          </ScrollView>
        )}

        <Text style={styles.hint}>
          Each cell is a fraction: type how many PO the Workshop received from that store on that day on top. The
          number under the line is what to expect — the purchases the store made that day, not counting bullion-only
          buys that stay in the store.
        </Text>

        {saveError ? (
          <InlineNotice tone="red" icon="alert-circle-outline" style={styles.notice}>
            {saveError}
          </InlineNotice>
        ) : null}

        <View style={styles.actions}>
          {savedAt && !dirty ? (
            <View style={styles.savedRow}>
              <Ionicons name="checkmark-circle" size={16} color={TONES.green.fg} />
              <Text style={styles.savedText}>Saved</Text>
            </View>
          ) : loading ? (
            <Text style={styles.savedText}>Loading…</Text>
          ) : (
            <View />
          )}
          <Pressable
            onPress={save}
            disabled={!dirty || saving}
            style={[styles.updateBtn, (!dirty || saving) && styles.updateBtnDisabled]}
            accessibilityRole="button"
            accessibilityLabel="Update daily check"
          >
            <Text style={styles.updateBtnText}>{saving ? 'Saving…' : 'Update'}</Text>
          </Pressable>
        </View>
      </ScrollView>
    </TriageDrawer>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
    minHeight: 0,
    backgroundColor: T.bg,
  },
  content: {
    paddingHorizontal: 22,
    paddingTop: 18,
    paddingBottom: 40,
    gap: 14,
  },
  contentMobile: {
    paddingHorizontal: 14,
    gap: 12,
  },
  mobileDays: {
    gap: 10,
  },
  mobileDayCard: {
    backgroundColor: T.card,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: T.hairline,
  },
  mobileDayHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 8,
    marginBottom: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: T.hairline,
  },
  mobileAllLabel: {
    fontFamily: FONT,
    fontSize: 15,
    fontWeight: '600',
    color: T.text,
    paddingBottom: 8,
  },
  mobileStoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    minHeight: 64,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: T.hairline,
  },
  mobileStoreRowLast: {
    borderBottomWidth: 0,
  },
  mobileStoreName: {
    flex: 1,
    minWidth: 0,
    fontFamily: FONT,
    fontSize: 16,
    fontWeight: '500',
    color: T.text,
  },
  hero: {
    paddingBottom: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: T.hairline,
  },
  heroLabel: {
    fontFamily: FONT,
    fontSize: 11,
    fontWeight: '600',
    color: T.secondary,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  heroRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginTop: 4,
  },
  heroValue: {
    fontFamily: FONT,
    fontSize: 34,
    fontWeight: '600',
    color: T.text,
    letterSpacing: -0.8,
    fontVariant: ['tabular-nums'],
  },
  heroOf: {
    fontSize: 20,
    fontWeight: '500',
    color: T.secondary,
    letterSpacing: -0.3,
  },
  heroMeta: {
    fontFamily: FONT,
    fontSize: 13,
    color: T.secondary,
    marginTop: 2,
    marginBottom: 10,
  },
  heroBar: {
    marginTop: 2,
  },
  notice: {
    alignSelf: 'stretch',
  },
  tableScroll: {
    flexGrow: 0,
  },
  table: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: T.hairline,
    overflow: 'hidden',
    backgroundColor: T.card,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: T.hairline,
  },
  rowLast: {
    borderBottomWidth: 0,
  },
  headRow: {
    backgroundColor: '#F5F5F7',
    minHeight: 48,
    alignItems: 'stretch',
  },
  headCell: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    justifyContent: 'center',
  },
  headText: {
    fontFamily: FONT,
    fontSize: 11,
    fontWeight: '600',
    color: T.secondary,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  headSub: {
    fontFamily: FONT,
    fontSize: 11,
    color: T.tertiary,
    marginTop: 2,
  },
  headStore: {
    alignItems: 'center',
    paddingHorizontal: 6,
  },
  headStoreText: {
    color: T.text,
    fontSize: 12,
    textAlign: 'center',
  },
  headTotal: {
    alignItems: 'flex-end',
  },
  headTotalText: {
    textAlign: 'right',
  },
  dayCell: {
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  dayWeekday: {
    fontFamily: FONT,
    fontSize: 11,
    fontWeight: '600',
    color: T.secondary,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  dayLabel: {
    fontFamily: FONT,
    fontSize: 15,
    fontWeight: '600',
    color: T.text,
  },
  cell: {
    paddingHorizontal: 6,
    paddingVertical: 8,
    alignItems: 'center',
  },
  cellBox: {
    alignItems: 'center',
    justifyContent: 'center',
    width: STORE_COL - 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: T.fill,
    backgroundColor: '#FAFAFC',
    paddingHorizontal: 8,
    paddingTop: 2,
    paddingBottom: 6,
    ...Platform.select({ web: { cursor: 'text' }, default: {} }),
  },
  cellBoxIdle: {
    borderStyle: 'dashed',
    backgroundColor: 'transparent',
  },
  cellBoxHover: {
    backgroundColor: '#f5f5f5',
    borderColor: T.hairline,
  },
  cellBoxFocused: {
    borderStyle: 'solid',
    borderColor: T.text,
    backgroundColor: '#fff',
    ...Platform.select({ web: { boxShadow: '0 0 0 3px rgba(0,0,0,0.10)' }, default: {} }),
  },
  cellInput: {
    fontFamily: FONT,
    fontSize: 20,
    fontWeight: '600',
    color: T.text,
    width: '100%',
    textAlign: 'center',
    paddingVertical: 4,
    fontVariant: ['tabular-nums'],
    ...Platform.select({ web: { outlineStyle: 'none' }, default: {} }),
  },
  cellLine: {
    width: '100%',
    marginVertical: 2,
  },
  cellExpected: {
    fontFamily: FONT,
    fontSize: 14,
    fontWeight: '500',
    color: T.secondary,
    fontVariant: ['tabular-nums'],
  },
  fraction: {
    alignItems: 'center',
    minWidth: 40,
  },
  fractionTop: {
    fontFamily: FONT,
    fontSize: 16,
    fontWeight: '600',
    color: T.text,
    fontVariant: ['tabular-nums'],
    paddingHorizontal: 4,
  },
  fractionTopLarge: {
    fontSize: 18,
  },
  fractionLine: {
    height: 1,
    alignSelf: 'stretch',
    backgroundColor: T.hairline,
    marginVertical: 2,
  },
  fractionBottom: {
    fontFamily: FONT,
    fontSize: 13,
    fontWeight: '500',
    color: T.secondary,
    fontVariant: ['tabular-nums'],
    paddingHorizontal: 4,
  },
  fractionBottomLarge: {
    fontSize: 14,
  },
  totalCell: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignItems: 'flex-end',
  },
  totalCellCentered: {
    alignItems: 'center',
  },
  footRow: {
    backgroundColor: '#FAFAFC',
    borderBottomWidth: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: T.hairline,
  },
  footLabel: {
    fontFamily: FONT,
    fontSize: 13,
    fontWeight: '600',
    color: T.text,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  hint: {
    fontFamily: FONT,
    fontSize: 12,
    color: T.secondary,
    lineHeight: 17,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingTop: 4,
  },
  savedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  savedText: {
    fontFamily: FONT,
    fontSize: 13,
    color: T.secondary,
  },
  updateBtn: {
    minWidth: 120,
    minHeight: 40,
    paddingHorizontal: 20,
    borderRadius: 10,
    backgroundColor: T.blue,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({ web: { cursor: 'pointer' }, default: {} }),
  },
  updateBtnDisabled: {
    opacity: 0.4,
  },
  updateBtnText: {
    fontFamily: FONT,
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
  },
});
