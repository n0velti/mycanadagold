import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useIsMobile } from '../lib/mobileUi';
import {
  collectAccuracyTriagePos,
  saveTriagePoReview,
  applyTriageReviewToPo,
  clearTriagePoReview,
  triagePoNeedsCorrection,
  useTransferWorkflow,
} from '../lib/transferWorkflow';
import {
  ColumnFilter,
  docNoun,
  matchesSelectedLabel,
  PoThumb,
  selectedLabels,
  TableActions,
  TableActionsHead,
  TableCell,
  TableDeleteButton,
  TableEmpty,
  TableFrame,
  TableMuted,
  TablePhotoCell,
  TableRow,
  TableRowMain,
  TableStrong,
  uniqueLabels,
} from './TriageTable';
import TriageReviewDrawer from './TriageReviewDrawer';
import { EmptyState, FONT, T, TextAction, TextTabs, TriageDrawer, useHeldValue } from './TriageKit';

const fontFamily = FONT;
const TEXT = T.text;
const SECONDARY = T.secondary;
const GREEN = T.green;
const RED = T.red;
const ORANGE = T.orange;
const BLUE = T.blue;
const HAIRLINE = T.hairline;

const ACCURACY_TABS = [
  { key: 'correct', label: 'Correct' },
  { key: 'incorrect', label: 'Incorrect' },
];

const EMPTY_FILTERS = {
  reference: [],
  dateLabel: [],
  person: [],
  store: [],
  received: [],
  errorType: [],
  errorAmount: [],
};

function namesMatch(a, b) {
  return (
    String(a || '')
      .trim()
      .localeCompare(String(b || '').trim(), undefined, { sensitivity: 'base' }) === 0
  );
}

function staffName(row) {
  const name = String(row?.employeeName || '').trim();
  return name && name !== '—' ? name : '';
}

function errorPlace(row) {
  const type = String(row?.review?.errorType || '').trim();
  if (type) return type;
  const corrections = Array.isArray(row?.review?.corrections) ? row.review.corrections : [];
  if (corrections.length) {
    const labels = corrections.map((item) => String(item?.label || '').toLowerCase());
    if (labels.some((label) => /\bqty\b|quantity/.test(label))) return 'Wrong quantity';
    if (labels.some((label) => /price|amount|unit/.test(label))) return 'Wrong price';
    if (labels.some((label) => /customer|client/.test(label))) return 'Wrong customer';
    if (labels.some((label) => /payment/.test(label))) return 'Wrong payment';
    if (labels.some((label) => /name|item/.test(label))) return 'Wrong item';
    return corrections[0].label || 'Unspecified';
  }
  if (String(row?.review?.note || '').trim()) return 'Note only';
  return 'Unspecified';
}

function countRanks(rows, getLabel) {
  const counts = new Map();
  for (const row of rows) {
    const label = String(getLabel(row) || '').trim();
    if (!label || label === '—') continue;
    const key = label.toLowerCase();
    const current = counts.get(key);
    if (current) current.count += 1;
    else counts.set(key, { label, count: 1 });
  }
  const total = rows.length || 1;
  return [...counts.values()]
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }))
    .map((row) => ({ ...row, pct: Math.round((row.count / total) * 100) }));
}

function karatFromText(text) {
  const match = String(text || '').match(/\b(24|22|21|18|14|10|9)\s*[-]?\s*k(?:t|arat)?s?\b/i);
  return match ? `${match[1]}K` : '';
}

function karatFromPurity(purity) {
  if (purity == null || purity === '') return '';
  let n = Number(purity);
  if (!Number.isFinite(n) || n <= 0) return '';
  if (n > 0 && n <= 1) n *= 100;
  if ([24, 22, 21, 18, 14, 10, 9].includes(n)) return `${n}K`;
  const table = [
    [99.9, 24],
    [91.6, 22],
    [87.5, 21],
    [75, 18],
    [58.5, 14],
    [41.7, 10],
    [37.5, 9],
  ];
  let best = null;
  for (const [mark, karat] of table) {
    const delta = Math.abs(n - mark);
    if (delta <= 2 && (!best || delta < best.delta)) best = { karat, delta };
  }
  return best ? `${best.karat}K` : '';
}

function prettyMetal(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (/\bpalladium\b/i.test(text)) return 'Palladium';
  if (/\bplatinum\b/i.test(text)) return 'Platinum';
  if (/\bsilver|sterling\b/i.test(text)) return 'Silver';
  if (/\bgold\b/i.test(text)) return 'Gold';
  return '';
}

function familyFromText(text) {
  const value = String(text || '');
  if (/\bscrap\b/i.test(value)) return 'Scrap';
  if (/\bcoin|maple|eagle|krugerrand|britannia|philharmonic|panda\b/i.test(value)) return 'Coins';
  if (/\bbar|wafer|ingot\b/i.test(value)) return 'Bars';
  if (/\bjewell?ery|ring|chain|bracelet|necklace|earring\b/i.test(value)) return 'Jewellery';
  return '';
}

function itemNamesOf(row) {
  const names = [];
  for (const name of Array.isArray(row?.itemNames) ? row.itemNames : []) {
    const text = String(name || '').trim();
    if (text) names.push(text);
  }
  for (const line of Array.isArray(row?.pricedLines) ? row.pricedLines : []) {
    const text = String(line?.name || '').trim();
    if (text) names.push(text);
  }
  for (const item of row?.review?.draft?.items || []) {
    const text = String(item?.name?.value || item?.name?.original || '').trim();
    if (text) names.push(text);
  }
  return names;
}

function collectItemBlobs(row) {
  const blobs = [];
  for (const line of Array.isArray(row?.pricedLines) ? row.pricedLines : []) {
    const text = [line?.name, line?.label, line?.searchText, line?.quality, line?.metal, line?.productType]
      .map((value) => String(value || '').trim())
      .filter(Boolean)
      .join(' ');
    if (!text && line?.purity == null) continue;
    blobs.push({
      text,
      metal: prettyMetal(line?.metal),
      purity: line?.purity,
      productType: String(line?.productType || ''),
    });
  }
  if (blobs.length) return blobs;
  for (const name of itemNamesOf(row)) {
    blobs.push({ text: name, metal: '', purity: null, productType: '' });
  }
  const search = String(row?.itemSearchText || '').trim();
  if (search) blobs.push({ text: search, metal: '', purity: null, productType: '' });
  return blobs;
}

function itemTagsOf(row) {
  const tags = new Set();
  for (const blob of collectItemBlobs(row)) {
    const karat = karatFromText(blob.text) || karatFromPurity(blob.purity);
    const metal = blob.metal || prettyMetal(blob.text);
    const family = familyFromText(blob.text) || familyFromText(blob.productType);
    if (karat && metal) tags.add(`${karat} ${metal}`);
    else if (karat) tags.add(karat);
    else if (metal) tags.add(metal);
    if (family) tags.add(family);
  }
  return [...tags];
}

function countDocTags(rows) {
  const counts = new Map();
  for (const row of rows) {
    const seen = new Set();
    for (const tag of itemTagsOf(row)) {
      const key = tag.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const current = counts.get(key);
      if (current) current.count += 1;
      else counts.set(key, { label: tag, count: 1 });
    }
  }
  const total = rows.length || 1;
  return [...counts.values()]
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }))
    .map((row) => ({ ...row, pct: Math.round((row.count / total) * 100) }));
}

function findErrorPatterns(rows) {
  const total = rows.length;
  if (total < 2) return [];

  const overallTags = countDocTags(rows);
  const overallStores = countRanks(rows, (row) => String(row.storeName || '').trim());
  const overallPeople = countRanks(rows, (row) => staffName(row) || 'Unknown');
  const grouped = new Map();
  for (const row of rows) {
    const type = errorPlace(row);
    if (!grouped.has(type)) grouped.set(type, []);
    grouped.get(type).push(row);
  }

  const patterns = [];
  const consider = ({ type, kind, label, count, subsetSize, overallPct }) => {
    const pct = Math.round((count / subsetSize) * 100);
    const lift = pct - overallPct;
    if (count < 2 || pct < 50 || overallPct >= 85) return;
    if (lift < 15 && pct < 80) return;
    const share = `${count} of ${subsetSize} (${pct}%) vs ${overallPct}% of all errors`;
    const headline =
      kind === 'tag'
        ? `${type} is concentrated on ${label}`
        : kind === 'store'
          ? `${type} shows up more at ${label}`
          : `${label} accounts for most ${type} errors`;
    patterns.push({
      key: `${type}|${kind}|${label}`,
      score: count * (1 + Math.max(lift, 0) / 50),
      headline,
      detail: share,
      type,
      kind,
      label,
    });
  };

  for (const [type, subset] of grouped) {
    if (subset.length < 2) continue;
    const subsetSize = subset.length;
    for (const tag of countDocTags(subset)) {
      const overall = overallTags.find((row) => namesMatch(row.label, tag.label));
      consider({
        type,
        kind: 'tag',
        label: tag.label,
        count: tag.count,
        subsetSize,
        overallPct: overall ? Math.round((overall.count / total) * 100) : 0,
      });
    }
    if (overallStores.length >= 2) {
      for (const store of countRanks(subset, (row) => String(row.storeName || '').trim())) {
        const overall = overallStores.find((row) => namesMatch(row.label, store.label));
        consider({
          type,
          kind: 'store',
          label: store.label,
          count: store.count,
          subsetSize,
          overallPct: overall ? Math.round((overall.count / total) * 100) : 0,
        });
      }
    }
    if (overallPeople.length >= 2) {
      for (const person of countRanks(subset, (row) => staffName(row) || 'Unknown')) {
        const overall = overallPeople.find((row) => namesMatch(row.label, person.label));
        consider({
          type,
          kind: 'person',
          label: person.label,
          count: person.count,
          subsetSize,
          overallPct: overall ? Math.round((overall.count / total) * 100) : 0,
        });
      }
    }
  }

  return patterns
    .sort((a, b) => b.score - a.score || a.headline.localeCompare(b.headline, undefined, { sensitivity: 'base' }))
    .slice(0, 6);
}

function rowMatchesErrorFocus(row, focus) {
  if (!focus) return true;
  if (focus.type && !namesMatch(errorPlace(row), focus.type)) return false;
  if (focus.kind === 'type') return namesMatch(errorPlace(row), focus.label);
  if (focus.kind === 'store') return namesMatch(row.storeName, focus.label);
  if (focus.kind === 'person') return namesMatch(staffName(row) || 'Unknown', focus.label);
  if (focus.kind === 'tag') return itemTagsOf(row).some((tag) => namesMatch(tag, focus.label));
  return true;
}

function RankGroup({ title, kind, ranks, focus, onPress }) {
  return (
    <>
      <Text style={styles.groupHeader}>{title}</Text>
      <View style={styles.group}>
        {ranks.length === 0 ? (
          <Text style={styles.emptyText}>None in this set</Text>
        ) : (
          ranks.map((rank, index) => {
            const active = Boolean(
              focus && focus.kind === kind && namesMatch(focus.label, rank.label),
            );
            const Row = onPress ? Pressable : View;
            return (
              <Row
                key={rank.label}
                style={[
                  styles.historyRow,
                  onPress && styles.rankPress,
                  index === ranks.length - 1 && styles.historyRowLast,
                ]}
                onPress={onPress ? () => onPress(rank) : undefined}
                accessibilityRole={onPress ? 'button' : undefined}
                accessibilityState={onPress ? { selected: active } : undefined}
              >
                <Text style={styles.personRank}>{index + 1}</Text>
                <Text
                  style={[styles.historyTitle, active && styles.historyTitleActive]}
                  numberOfLines={1}
                >
                  {rank.label}
                </Text>
                <Text style={styles.personMeta}>
                  {rank.count} · {rank.pct}%
                </Text>
                {onPress ? <Ionicons name="chevron-forward" size={14} color="#c7c7cc" /> : null}
              </Row>
            );
          })
        )}
      </View>
    </>
  );
}

function formatPct(value) {
  if (!Number.isFinite(value)) return '—';
  return `${Math.round(value)}%`;
}

function accuracyTint(pct) {
  if (pct >= 90) return GREEN;
  if (pct >= 75) return ORANGE;
  return RED;
}

function rowMatchesSharedFilters(row, filters) {
  return (
    matchesSelectedLabel(row.reference, filters.reference) &&
    matchesSelectedLabel(row.dateLabel, filters.dateLabel) &&
    matchesSelectedLabel(staffName(row), filters.person) &&
    matchesSelectedLabel(row.storeName, filters.store) &&
    matchesSelectedLabel(row.triageDateLabel, filters.received)
  );
}

function rowMatchesErrorFilters(row, filters) {
  return (
    matchesSelectedLabel(row.review?.errorType, filters.errorType) &&
    matchesSelectedLabel(row.review?.errorAmount, filters.errorAmount)
  );
}

function filtersAreActive(filters) {
  return Object.values(filters).some((value) => selectedLabels(value).length > 0);
}

function scopeCaption(filters, storeFilter) {
  const parts = [];
  const push = (values) => {
    for (const value of selectedLabels(values)) {
      if (!parts.some((part) => namesMatch(part, value))) parts.push(value);
    }
  };
  if (storeFilter) parts.push(storeFilter);
  push(filters.store);
  push(filters.person);
  push(filters.dateLabel);
  push(filters.received);
  push(filters.reference);
  return parts.slice(0, 3).join(' · ') || 'All purchases';
}

function InsightSplit({ correctCount, incorrectCount }) {
  const total = correctCount + incorrectCount;
  return (
    <View style={styles.splitTrack} accessibilityLabel="Correct versus incorrect split">
      <View
        style={[
          styles.splitFill,
          { flex: total ? correctCount : 1, backgroundColor: GREEN },
        ]}
      />
      <View
        style={[
          styles.splitFill,
          { flex: total ? incorrectCount : 0, backgroundColor: RED },
        ]}
      />
    </View>
  );
}

function AccuracyInsights({ scoped, activeTab, caption, mobile, onPersonPress, onErrorsPress }) {
  const total = scoped.length;
  const incorrectRows = useMemo(
    () => scoped.filter((row) => triagePoNeedsCorrection(row)),
    [scoped],
  );
  const correctCount = total - incorrectRows.length;
  const incorrectCount = incorrectRows.length;
  const accuracyPct = total ? (correctCount / total) * 100 : null;
  const incorrectPct = total ? (incorrectCount / total) * 100 : null;
  const errorRanks = useMemo(() => countRanks(incorrectRows, errorPlace), [incorrectRows]);
  const peopleRanks = useMemo(
    () => countRanks(incorrectRows, (row) => staffName(row) || 'Unknown'),
    [incorrectRows],
  );
  const topError = errorRanks[0] || null;
  const nextError = errorRanks[1] || null;
  const people = peopleRanks.slice(0, 3);
  const viewingIncorrect = activeTab === 'incorrect';

  return (
    <View style={styles.insightsWrap}>
      <View style={[styles.insightsCard, mobile && styles.insightsCardMobile]}>
        <View style={[styles.insightsCol, mobile && styles.insightsColMobile]}>
          <Text style={styles.insightsKicker}>Accuracy</Text>
          <Text style={[styles.insightsHero, { color: accuracyPct == null ? TEXT : accuracyTint(accuracyPct) }]}>
            {formatPct(accuracyPct)}
          </Text>
          <Text style={styles.insightsSub} numberOfLines={1}>
            {total
              ? `${correctCount} correct · ${incorrectCount} incorrect`
              : 'No matching purchases'}
          </Text>
          <InsightSplit correctCount={correctCount} incorrectCount={incorrectCount} />
          <Text style={styles.insightsCaption} numberOfLines={1}>
            {caption}
          </Text>
        </View>

        <Pressable
          style={[
            styles.insightsCol,
            styles.insightsColSplit,
            mobile && styles.insightsColMobile,
            mobile && styles.insightsColSplitMobile,
            styles.errorsHit,
          ]}
          onPress={() => onErrorsPress?.()}
          accessibilityRole="button"
          accessibilityLabel="Error breakdown"
        >
          <View style={styles.insightsKickerRow}>
            <Text style={styles.insightsKicker}>Errors</Text>
            <Ionicons name="chevron-forward" size={14} color="#c7c7cc" />
          </View>
          {topError ? (
            <>
              <Text style={styles.insightsTitle} numberOfLines={1}>
                {topError.label}
              </Text>
              <Text style={styles.insightsSub} numberOfLines={1}>
                {topError.count} of {incorrectCount} · {topError.pct}%
              </Text>
              {nextError ? (
                <Text style={styles.insightsCaption} numberOfLines={1}>
                  Then {nextError.label} · {nextError.pct}%
                </Text>
              ) : (
                <Text style={styles.insightsCaption}>Majority of errors</Text>
              )}
            </>
          ) : (
            <>
              <Text style={styles.insightsTitle}>No errors</Text>
              <Text style={styles.insightsSub}>Nothing to break down yet</Text>
            </>
          )}
        </Pressable>

        <View
          style={[
            styles.insightsCol,
            styles.insightsColSplit,
            mobile && styles.insightsColMobile,
            mobile && styles.insightsColSplitMobile,
          ]}
        >
          <Text style={styles.insightsKicker}>People</Text>
          {people.length ? (
            people.map((person, index) => (
              <Pressable
                key={person.label}
                style={styles.personRow}
                onPress={() => onPersonPress?.(person.label)}
                accessibilityRole="button"
                accessibilityLabel={`${person.label} error history`}
              >
                <Text style={styles.personRank}>{index + 1}</Text>
                <Text style={styles.personName} numberOfLines={1}>
                  {person.label}
                </Text>
                <Text style={styles.personMeta}>
                  {person.count} · {person.pct}%
                </Text>
                <Ionicons name="chevron-forward" size={14} color="#c7c7cc" />
              </Pressable>
            ))
          ) : (
            <>
              <Text style={styles.insightsTitle}>No errors</Text>
              <Text style={styles.insightsSub}>No staff ranking yet</Text>
            </>
          )}
        </View>
      </View>
      <Text style={styles.viewingLine} numberOfLines={1}>
        {viewingIncorrect
          ? `${incorrectCount} incorrect · ${formatPct(incorrectPct)} of this set`
          : `${correctCount} correct · ${formatPct(accuracyPct)} of this set`}
      </Text>
    </View>
  );
}

function EmployeeErrorDrawer({ visible, name, rows, onClose, onOpenPo }) {
  const heldName = useHeldValue(name);

  const docs = useMemo(() => {
    if (!heldName) return [];
    return (rows || []).filter((row) => namesMatch(staffName(row) || 'Unknown', heldName));
  }, [heldName, rows]);

  const categories = useMemo(() => countRanks(docs, errorPlace), [docs]);
  const top = categories[0] || null;

  if (!heldName) return null;

  return (
    <TriageDrawer visible={visible} onClose={onClose} title={heldName} widthRatio={0.42} minWidth={380}>
      <ScrollView
        style={styles.drawerBody}
        contentContainerStyle={styles.drawerContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.historyHero}>
          <Text style={styles.historyHeroCount}>{docs.length}</Text>
          <Text style={styles.historyHeroLabel}>
            {`incorrect ${docNoun(docs)}`}
          </Text>
          {top ? (
            <Text style={styles.historyHeroSub} numberOfLines={2}>
              Mostly {top.label} · {top.pct}% of their errors
            </Text>
          ) : (
            <Text style={styles.historyHeroSub}>No errors in this set</Text>
          )}
        </View>

        <Text style={styles.groupHeader}>Categories</Text>
        <View style={styles.group}>
          {categories.length === 0 ? (
            <Text style={styles.emptyText}>No error categories</Text>
          ) : (
            categories.map((category, index) => (
              <View
                key={category.label}
                style={[styles.historyRow, index === categories.length - 1 && styles.historyRowLast]}
              >
                <Text style={styles.personRank}>{index + 1}</Text>
                <Text style={styles.historyTitle} numberOfLines={1}>
                  {category.label}
                </Text>
                <Text style={styles.personMeta}>
                  {category.count} · {category.pct}%
                </Text>
              </View>
            ))
          )}
        </View>

        <Text style={styles.groupHeader}>PO / SO</Text>
        <View style={styles.group}>
          {docs.length === 0 ? (
            <Text style={styles.emptyText}>No PO / SO</Text>
          ) : (
            docs.map((row, index) => {
              const subtitle = [
                errorPlace(row),
                row.storeName,
                row.dateLabel,
                row.received ? null : 'Not received',
              ]
                .filter(Boolean)
                .join(' · ');
              return (
                <Pressable
                  key={`${row.triageId}-${row.id}`}
                  style={[styles.historyDoc, index === docs.length - 1 && styles.historyRowLast]}
                  onPress={() => onOpenPo?.(row)}
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${row.reference}`}
                >
                  <View style={styles.historyDocText}>
                    <Text style={styles.historyTitle} numberOfLines={1}>
                      {row.reference}
                    </Text>
                    {subtitle ? (
                      <Text style={styles.historySub} numberOfLines={2}>
                        {subtitle}
                      </Text>
                    ) : null}
                  </View>
                  <Ionicons name="chevron-forward" size={16} color="#c7c7cc" />
                </Pressable>
              );
            })
          )}
        </View>
      </ScrollView>
    </TriageDrawer>
  );
}

function ErrorBreakdownDrawer({ visible, rows, total, onClose, onOpenPo }) {
  const heldRowsRaw = useHeldValue(visible ? rows : null);
  const heldRows = useMemo(() => heldRowsRaw || [], [heldRowsRaw]);
  const heldTotal = useHeldValue(visible ? total : null) ?? 0;
  const [focus, setFocus] = useState(null);

  useEffect(() => {
    if (!visible) setFocus(null);
  }, [visible]);

  const categories = useMemo(() => countRanks(heldRows, errorPlace), [heldRows]);
  const stores = useMemo(() => countRanks(heldRows, (row) => String(row.storeName || '').trim()), [heldRows]);
  const people = useMemo(
    () => countRanks(heldRows, (row) => staffName(row) || 'Unknown'),
    [heldRows],
  );
  const items = useMemo(() => countDocTags(heldRows), [heldRows]);
  const patterns = useMemo(() => findErrorPatterns(heldRows), [heldRows]);
  const top = categories[0] || null;
  const incorrectPct = heldTotal ? Math.round((heldRows.length / heldTotal) * 100) : 0;

  const docs = useMemo(
    () => heldRows.filter((row) => rowMatchesErrorFocus(row, focus)),
    [heldRows, focus],
  );

  const toggleFocus = useCallback((next) => {
    setFocus((current) => {
      if (
        current &&
        current.kind === next.kind &&
        namesMatch(current.label, next.label) &&
        namesMatch(current.type || '', next.type || '')
      ) {
        return null;
      }
      return next;
    });
  }, []);

  return (
    <TriageDrawer visible={visible} onClose={onClose} title="Errors" widthRatio={0.46} minWidth={400}>
          <ScrollView
            style={styles.drawerBody}
            contentContainerStyle={styles.drawerContent}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.historyHero}>
              <Text style={styles.historyHeroCount}>{heldRows.length}</Text>
              <Text style={styles.historyHeroLabel}>
                {`incorrect ${docNoun(heldRows)}`}
              </Text>
              {heldRows.length ? (
                <Text style={styles.historyHeroSub} numberOfLines={2}>
                  {heldTotal
                    ? `${incorrectPct}% of this set`
                    : 'This set'}
                  {top ? ` · mostly ${top.label} (${top.pct}%)` : ''}
                </Text>
              ) : (
                <Text style={styles.historyHeroSub}>No errors in this set</Text>
              )}
            </View>

            <Text style={styles.groupHeader}>Patterns</Text>
            {patterns.length === 0 ? (
              <View style={styles.group}>
                <Text style={styles.emptyText}>
                  {heldRows.length < 2
                    ? 'Need more errors before patterns show up.'
                    : 'No strong item, store, or people patterns yet.'}
                </Text>
              </View>
            ) : (
              <View style={styles.patternList}>
                {patterns.map((pattern) => {
                  const active =
                    focus &&
                    focus.kind === pattern.kind &&
                    namesMatch(focus.label, pattern.label) &&
                    namesMatch(focus.type || '', pattern.type || '');
                  return (
                    <Pressable
                      key={pattern.key}
                      style={[styles.patternCard, active && styles.patternCardActive]}
                      onPress={() =>
                        toggleFocus({
                          kind: pattern.kind,
                          label: pattern.label,
                          type: pattern.type,
                          caption: pattern.headline,
                        })
                      }
                      accessibilityRole="button"
                      accessibilityLabel={pattern.headline}
                    >
                      <Text style={styles.patternKicker}>Pattern</Text>
                      <Text style={styles.patternHeadline}>{pattern.headline}</Text>
                      <Text style={styles.patternDetail}>{pattern.detail}</Text>
                    </Pressable>
                  );
                })}
              </View>
            )}

            <RankGroup
              title="What"
              kind="type"
              ranks={categories}
              focus={focus}
              onPress={(rank) =>
                toggleFocus({
                  kind: 'type',
                  label: rank.label,
                  caption: rank.label,
                })
              }
            />
            <RankGroup
              title="Items"
              kind="tag"
              ranks={items}
              focus={focus}
              onPress={(rank) =>
                toggleFocus({
                  kind: 'tag',
                  label: rank.label,
                  caption: rank.label,
                })
              }
            />
            <RankGroup
              title="Where"
              kind="store"
              ranks={stores}
              focus={focus}
              onPress={(rank) =>
                toggleFocus({
                  kind: 'store',
                  label: rank.label,
                  caption: rank.label,
                })
              }
            />
            <RankGroup
              title="Who"
              kind="person"
              ranks={people}
              focus={focus}
              onPress={(rank) =>
                toggleFocus({
                  kind: 'person',
                  label: rank.label,
                  caption: rank.label,
                })
              }
            />

            <View style={styles.poHeaderRow}>
              <Text style={styles.groupHeaderInline}>
                PO / SO
                {focus ? ` · ${docs.length}` : ''}
              </Text>
              {focus ? (
                <TextAction label="Clear" onPress={() => setFocus(null)} accessibilityLabel="Clear error filter" />
              ) : null}
            </View>
            {focus ? (
              <Text style={styles.focusCaption} numberOfLines={2}>
                {focus.caption || focus.label}
                {focus.type && focus.kind !== 'type' ? ` · ${focus.type}` : ''}
              </Text>
            ) : null}
            <View style={styles.group}>
              {docs.length === 0 ? (
                <Text style={styles.emptyText}>No PO / SO</Text>
              ) : (
                docs.map((row, index) => {
                  const tags = itemTagsOf(row).slice(0, 2).join(' · ');
                  const subtitle = [
                    errorPlace(row),
                    staffName(row) || 'Unknown',
                    row.storeName,
                    tags,
                    row.dateLabel,
                  ]
                    .filter(Boolean)
                    .join(' · ');
                  return (
                    <Pressable
                      key={`${row.triageId}-${row.id}`}
                      style={[styles.historyDoc, index === docs.length - 1 && styles.historyRowLast]}
                      onPress={() => onOpenPo?.(row)}
                      accessibilityRole="button"
                      accessibilityLabel={`Open ${row.reference}`}
                    >
                      <View style={styles.historyDocText}>
                        <Text style={styles.historyTitle} numberOfLines={1}>
                          {row.reference}
                        </Text>
                        {subtitle ? (
                          <Text style={styles.historySub} numberOfLines={2}>
                            {subtitle}
                          </Text>
                        ) : null}
                      </View>
                      <Ionicons name="chevron-forward" size={16} color="#c7c7cc" />
                    </Pressable>
                  );
                })
              )}
            </View>
          </ScrollView>
    </TriageDrawer>
  );
}

const AccuracyTableRow = memo(function AccuracyTableRow({ row, last, showError, onOpen, onDelete }) {
  const review = row.review || {};
  const photo = (
    <TablePhotoCell>
      <PoThumb urls={row.imageUrls} label={row.reference} />
    </TablePhotoCell>
  );
  const cells = (
    <>
      <TableCell flex={1.15} minWidth={108}>
        <TableStrong>{row.reference}</TableStrong>
        {showError && !row.received ? <TableMuted>Not received</TableMuted> : null}
      </TableCell>
      <TableCell flex={0.9} minWidth={92}>
        {row.dateLabel}
      </TableCell>
      <TableCell flex={1.15} minWidth={110}>
        {staffName(row)}
      </TableCell>
      <TableCell flex={1.1} minWidth={110}>
        {row.storeName}
      </TableCell>
      {showError ? (
        <>
          <TableCell flex={1} minWidth={110}>
            {review.errorType || errorPlace(row)}
          </TableCell>
          <TableCell flex={0.85} minWidth={88} last={!onDelete}>
            {review.errorAmount}
          </TableCell>
        </>
      ) : (
        <TableCell flex={0.95} minWidth={100} last>
          {row.triageDateLabel}
        </TableCell>
      )}
    </>
  );

  if (!onDelete) {
    return (
      <TableRow last={last}>
        {photo}
        <TableRowMain onPress={() => onOpen(row)} accessibilityLabel={`Open ${row.reference}`}>
          {cells}
        </TableRowMain>
      </TableRow>
    );
  }

  return (
    <TableRow last={last}>
      {photo}
      <TableRowMain onPress={() => onOpen(row)} accessibilityLabel={`Open ${row.reference}`}>
        {cells}
      </TableRowMain>
      <TableActions>
        <TableDeleteButton
          onPress={() => onDelete(row)}
          label={`Delete review for ${row.reference}`}
        />
      </TableActions>
    </TableRow>
  );
});

function accuracyKey(row) {
  return `${row.triageId}-${row.id}`;
}

export default function TriageAccuracyPanel({ session, storeFilter }) {
  const isMobile = useIsMobile();
  const { triage } = useTransferWorkflow();
  const [activeTab, setActiveTab] = useState('correct');
  const [openRow, setOpenRow] = useState(null);
  const [openPerson, setOpenPerson] = useState(null);
  const [openErrors, setOpenErrors] = useState(false);
  const [openFilter, setOpenFilter] = useState(null);
  const [filters, setFilters] = useState(EMPTY_FILTERS);

  const accuracyRows = useMemo(() => {
    const rows = collectAccuracyTriagePos(triage);
    if (!storeFilter) return rows;
    return rows.filter((row) => namesMatch(row.storeName, storeFilter));
  }, [storeFilter, triage]);

  const showError = activeTab === 'incorrect';
  const filtersActive = filtersAreActive(filters);

  const setFilter = useCallback((key, value) => {
    setFilters((current) => ({ ...current, [key]: value }));
  }, []);

  const changeTab = useCallback((key) => {
    setActiveTab(key);
    setOpenFilter(null);
  }, []);

  const clearFilters = useCallback(() => {
    setFilters(EMPTY_FILTERS);
    setOpenFilter(null);
  }, []);

  const scoped = useMemo(
    () => accuracyRows.filter((row) => rowMatchesSharedFilters(row, filters)),
    [accuracyRows, filters],
  );

  const incorrectScoped = useMemo(
    () => scoped.filter((row) => triagePoNeedsCorrection(row)),
    [scoped],
  );

  const source = useMemo(
    () =>
      scoped.filter((row) =>
        showError ? triagePoNeedsCorrection(row) : Boolean(row.received) && !triagePoNeedsCorrection(row),
      ),
    [scoped, showError],
  );

  const visible = useMemo(
    () => (showError ? source.filter((row) => rowMatchesErrorFilters(row, filters)) : source),
    [filters, showError, source],
  );

  const tabOptions = useMemo(() => {
    const correct = scoped.filter((row) => Boolean(row.received) && !triagePoNeedsCorrection(row)).length;
    return ACCURACY_TABS.map((tab) => ({
      ...tab,
      count: tab.key === 'incorrect' ? incorrectScoped.length : correct,
    }));
  }, [incorrectScoped.length, scoped]);

  const optionsFor = useCallback(
    (key, getValue, rows = accuracyRows) => {
      const relaxed = { ...filters, [key]: [] };
      return uniqueLabels(
        rows
          .filter((row) => {
            if (!rowMatchesSharedFilters(row, relaxed)) return false;
            if (showError && (key === 'errorType' || key === 'errorAmount')) {
              return triagePoNeedsCorrection(row) && rowMatchesErrorFilters(row, relaxed);
            }
            return true;
          })
          .map(getValue),
      );
    },
    [filters, accuracyRows, showError],
  );

  const referenceOptions = useMemo(
    () => optionsFor('reference', (row) => row.reference),
    [optionsFor],
  );
  const dateOptions = useMemo(() => optionsFor('dateLabel', (row) => row.dateLabel), [optionsFor]);
  const personOptions = useMemo(() => optionsFor('person', staffName), [optionsFor]);
  const storeOptions = useMemo(() => optionsFor('store', (row) => row.storeName), [optionsFor]);
  const receivedOptions = useMemo(
    () => optionsFor('received', (row) => row.triageDateLabel),
    [optionsFor],
  );
  const errorTypeOptions = useMemo(
    () => optionsFor('errorType', (row) => row.review?.errorType || errorPlace(row), scoped),
    [optionsFor, scoped],
  );
  const errorAmountOptions = useMemo(
    () => optionsFor('errorAmount', (row) => row.review?.errorAmount, scoped),
    [optionsFor, scoped],
  );

  const saveReview = useCallback((poId, review) => {
    saveTriagePoReview(poId, review);
    setOpenRow((current) => (current?.id === poId ? applyTriageReviewToPo(current, review) : current));
  }, []);

  const deleteReview = useCallback((row) => {
    if (!row?.id) return;
    clearTriagePoReview(row.id);
    setOpenRow((current) => (current?.id === row.id ? null : current));
  }, []);

  const openFromTable = useCallback((item) => {
    setOpenFilter(null);
    setOpenRow(item);
  }, []);
  const renderAccuracyRow = useCallback(
    ({ item, index }) => (
      <AccuracyTableRow
        row={item}
        last={index === visible.length - 1}
        showError={showError}
        onDelete={showError ? deleteReview : undefined}
        onOpen={openFromTable}
      />
    ),
    [deleteReview, openFromTable, showError, visible.length],
  );

  if (accuracyRows.length === 0) {
    return (
      <View style={[styles.body]}>
        <EmptyState
          icon="checkmark-done-outline"
          title="Accuracy"
          body="Received POs and reviewed corrections will appear here."
        />
      </View>
    );
  }

  return (
    <View style={[styles.body]}>
      <AccuracyInsights
        scoped={scoped}
        activeTab={activeTab}
        caption={scopeCaption(filters, storeFilter)}
        mobile={isMobile}
        onPersonPress={setOpenPerson}
        onErrorsPress={() => setOpenErrors(true)}
      />
      <TextTabs
        options={tabOptions}
        value={activeTab}
        onChange={changeTab}
        style={styles.listChrome}
        trailing={
          <>
            <Text style={styles.listMeta}>
              {visible.length}
              {visible.length !== source.length ? ` of ${source.length}` : ''}
              {' '}
              {docNoun(source)}
            </Text>
            {filtersActive ? <TextAction label="Clear" onPress={clearFilters} accessibilityLabel="Clear filters" /> : null}
          </>
        }
      />

          <TableFrame
            minWidth={showError ? 900 : 720}
            data={visible}
            renderItem={renderAccuracyRow}
            keyExtractor={accuracyKey}
            extraData={showError}
            ListEmptyComponent={
              <TableEmpty>
                {source.length === 0
                  ? showError
                    ? 'No incorrect purchases in this set.'
                    : 'No correct purchases in this set.'
                  : 'No PO or SO matches that column filter.'}
              </TableEmpty>
            }
            header={
              <>
                <TablePhotoCell />
                <ColumnFilter
                  columnKey="reference"
                  label="PO / SO"
                  value={filters.reference}
                  onChange={(value) => setFilter('reference', value)}
                  options={referenceOptions}
                  openKey={openFilter}
                  onOpenKey={setOpenFilter}
                  style={{ flex: 1.15, minWidth: 108 }}
                />
                <ColumnFilter
                  columnKey="dateLabel"
                  label="Date"
                  value={filters.dateLabel}
                  onChange={(value) => setFilter('dateLabel', value)}
                  options={dateOptions}
                  openKey={openFilter}
                  onOpenKey={setOpenFilter}
                  style={{ flex: 0.9, minWidth: 92 }}
                />
                <ColumnFilter
                  columnKey="person"
                  label="Person"
                  value={filters.person}
                  onChange={(value) => setFilter('person', value)}
                  options={personOptions}
                  openKey={openFilter}
                  onOpenKey={setOpenFilter}
                  style={{ flex: 1.15, minWidth: 110 }}
                />
                <ColumnFilter
                  columnKey="store"
                  label="Store"
                  value={filters.store}
                  onChange={(value) => setFilter('store', value)}
                  options={storeOptions}
                  openKey={openFilter}
                  onOpenKey={setOpenFilter}
                  style={{ flex: 1.1, minWidth: 110 }}
                />
                {showError ? (
                  <>
                    <ColumnFilter
                      columnKey="errorType"
                      label="Error"
                      value={filters.errorType}
                      onChange={(value) => setFilter('errorType', value)}
                      options={errorTypeOptions}
                      openKey={openFilter}
                      onOpenKey={setOpenFilter}
                      style={{ flex: 1, minWidth: 110 }}
                    />
                    <ColumnFilter
                      columnKey="errorAmount"
                      label="Amount"
                      value={filters.errorAmount}
                      onChange={(value) => setFilter('errorAmount', value)}
                      options={errorAmountOptions}
                      openKey={openFilter}
                      onOpenKey={setOpenFilter}
                      align="end"
                      style={{ flex: 0.85, minWidth: 88 }}
                    />
                    <TableActionsHead />
                  </>
                ) : (
                  <ColumnFilter
                    columnKey="received"
                    label="Received"
                    value={filters.received}
                    onChange={(value) => setFilter('received', value)}
                    options={receivedOptions}
                    openKey={openFilter}
                    onOpenKey={setOpenFilter}
                    align="end"
                    style={{ flex: 0.95, minWidth: 100 }}
                  />
                )}
              </>
            }
          />

          <ErrorBreakdownDrawer
            visible={openErrors}
            rows={incorrectScoped}
            total={scoped.length}
            onClose={() => setOpenErrors(false)}
            onOpenPo={(row) => setOpenRow(row)}
          />
          <EmployeeErrorDrawer
            visible={Boolean(openPerson)}
            name={openPerson}
            rows={incorrectScoped}
            onClose={() => setOpenPerson(null)}
            onOpenPo={(row) => setOpenRow(row)}
          />
          <TriageReviewDrawer
            visible={Boolean(openRow)}
            session={session}
            row={openRow}
            review={openRow?.review || null}
            extraRows={accuracyRows}
            onClose={() => setOpenRow(null)}
            onSave={saveReview}
          />
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
    minHeight: 0,
    backgroundColor: T.bg,
  },
  insightsWrap: {
    flexShrink: 0,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 4,
    gap: 10,
  },
  insightsCard: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderRadius: 12,
    overflow: 'hidden',
    ...Platform.select({
      web: { boxShadow: '0 1px 2px rgba(0,0,0,0.04)' },
      default: {},
    }),
  },
  insightsCardMobile: {
    flexDirection: 'column',
  },
  insightsCol: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: 14,
    paddingVertical: 11,
    gap: 3,
  },
  insightsColMobile: {
    flex: 0,
    flexBasis: 'auto',
    flexShrink: 0,
  },
  insightsColSplit: {
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: HAIRLINE,
  },
  insightsColSplitMobile: {
    borderLeftWidth: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: HAIRLINE,
  },
  errorsHit: {
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  insightsKickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  insightsKicker: {
    fontFamily,
    fontSize: 11,
    fontWeight: '600',
    color: SECONDARY,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  insightsHero: {
    fontFamily,
    fontSize: 24,
    fontWeight: '700',
    letterSpacing: -0.6,
  },
  insightsTitle: {
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: TEXT,
    letterSpacing: -0.3,
  },
  insightsSub: {
    fontFamily,
    fontSize: 12.5,
    color: TEXT,
    letterSpacing: -0.08,
  },
  insightsCaption: {
    fontFamily,
    fontSize: 11.5,
    color: SECONDARY,
  },
  splitTrack: {
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
    flexDirection: 'row',
    backgroundColor: '#e5e5ea',
    marginTop: 4,
    marginBottom: 2,
  },
  splitFill: {
    minWidth: 0,
  },
  personRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 24,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  personRank: {
    fontFamily,
    width: 12,
    fontSize: 12,
    fontWeight: '600',
    color: SECONDARY,
  },
  personName: {
    fontFamily,
    flex: 1,
    minWidth: 0,
    fontSize: 13,
    fontWeight: '600',
    color: TEXT,
    letterSpacing: -0.08,
  },
  personMeta: {
    fontFamily,
    fontSize: 12,
    color: SECONDARY,
    fontVariant: ['tabular-nums'],
  },
  viewingLine: {
    fontFamily,
    fontSize: 12,
    color: SECONDARY,
    paddingHorizontal: 4,
    paddingTop: 2,
  },
  listChrome: {
    borderBottomWidth: 0,
    paddingTop: 4,
  },
  listMeta: {
    fontFamily,
    fontSize: 13,
    fontWeight: '400',
    color: SECONDARY,
  },
  drawerBody: {
    flex: 1,
    minHeight: 0,
  },
  drawerContent: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 32,
  },
  historyHero: {
    paddingHorizontal: 4,
    paddingTop: 12,
    paddingBottom: 8,
    gap: 4,
  },
  historyHeroCount: {
    fontFamily,
    fontSize: 34,
    fontWeight: '700',
    color: TEXT,
    letterSpacing: -1,
  },
  historyHeroLabel: {
    fontFamily,
    fontSize: 17,
    fontWeight: '600',
    color: TEXT,
  },
  historyHeroSub: {
    fontFamily,
    fontSize: 15,
    color: SECONDARY,
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
    overflow: 'hidden',
  },
  emptyText: {
    fontFamily,
    fontSize: 16,
    color: SECONDARY,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 44,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: HAIRLINE,
  },
  rankPress: {
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  historyRowLast: {
    borderBottomWidth: 0,
  },
  historyDoc: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 56,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: HAIRLINE,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  historyDocText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  historyTitle: {
    fontFamily,
    flex: 1,
    minWidth: 0,
    fontSize: 17,
    fontWeight: '400',
    color: TEXT,
  },
  historyTitleActive: {
    color: BLUE,
    fontWeight: '600',
  },
  poHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 12,
    marginTop: 18,
    marginBottom: 6,
    marginLeft: 4,
  },
  groupHeaderInline: {
    fontFamily,
    flex: 1,
    minWidth: 0,
    fontSize: 13,
    fontWeight: '400',
    color: SECONDARY,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  focusCaption: {
    fontFamily,
    fontSize: 13,
    color: BLUE,
    marginTop: -2,
    marginBottom: 8,
    marginLeft: 4,
  },
  patternList: {
    gap: 8,
  },
  patternCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 4,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  patternCardActive: {
    backgroundColor: 'rgba(0, 122, 255, 0.08)',
  },
  patternKicker: {
    fontFamily,
    fontSize: 11,
    fontWeight: '600',
    color: ORANGE,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  patternHeadline: {
    fontFamily,
    fontSize: 17,
    fontWeight: '600',
    color: TEXT,
    letterSpacing: -0.3,
  },
  patternDetail: {
    fontFamily,
    fontSize: 13,
    lineHeight: 18,
    color: SECONDARY,
  },
  historySub: {
    fontFamily,
    fontSize: 13,
    color: SECONDARY,
  },
});
