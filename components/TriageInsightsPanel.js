/**
 * Store-details triage insights for one branch.
 * Branch managers, GMs, and admins open this from that store’s Triage app.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  fetchTriageInsightSnapshot,
  formatInsightCount,
  formatInsightPercent,
  insightForStore,
} from '../lib/triageInsights';
import { storeMarkColor, storeShortCode } from '../lib/storeMarks';
import { CANVAS, MOBILE, MOBILE_FILTER_INSET, useIsMobile } from '../lib/mobileUi';
import { FONT } from '../lib/typography';

const fontFamily = FONT;
const DIVIDER = '#d0d0d0';

function StoreMark({ name, size = 28 }) {
  const code = storeShortCode(name);
  if (!code) {
    return <View style={[styles.storeMark, styles.storeMarkEmpty, { width: size, height: size }]} />;
  }
  return (
    <View
      style={[
        styles.storeMark,
        { width: size, height: size, backgroundColor: storeMarkColor(name) },
      ]}
    >
      <Text style={[styles.storeMarkText, size < 26 && styles.storeMarkTextSm]} numberOfLines={1}>
        {code}
      </Text>
    </View>
  );
}

function CountLine({ correct, incorrect }) {
  const parts = [
    formatInsightCount(correct, 'correct', 'correct'),
    formatInsightCount(incorrect, 'incorrect', 'incorrect'),
  ];
  return parts.join(' · ');
}

function InsightRow({
  title,
  meta,
  value,
  valueTone,
  last,
  onPress,
  leading,
  compact = false,
}) {
  const body = (
    <View style={[compact ? styles.mobileRowBody : styles.deskRowBody, !last && styles.rowDivider]}>
      {leading}
      <View style={styles.rowCopy}>
        <Text style={compact ? styles.mobileName : styles.deskName} numberOfLines={1}>
          {title}
        </Text>
        {meta ? (
          <Text style={compact ? styles.mobileMeta : styles.deskMeta} numberOfLines={2}>
            {meta}
          </Text>
        ) : null}
      </View>
      {value ? (
        <Text
          style={[
            compact ? styles.mobileValue : styles.deskValue,
            valueTone === 'red' && styles.valueRed,
            valueTone === 'green' && styles.valueGreen,
            valueTone === 'muted' && styles.valueMuted,
          ]}
          numberOfLines={1}
        >
          {value}
        </Text>
      ) : null}
      {onPress ? (
        <View style={styles.chevron}>
          <Ionicons name="chevron-forward" size={18} color="#c7c7cc" />
        </View>
      ) : null}
    </View>
  );

  if (!onPress) {
    return <View style={compact ? styles.mobileRow : styles.deskRow}>{body}</View>;
  }

  return (
    <Pressable
      onPress={onPress}
      style={({ hovered, pressed }) => [
        compact ? styles.mobileRow : styles.deskRow,
        (hovered || pressed) && styles.rowHovered,
      ]}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${meta || ''} ${value || ''}`}
    >
      {body}
    </Pressable>
  );
}

function SectionBlock({ title, children, last = false }) {
  return (
    <View style={[styles.block, last && styles.blockLast]}>
      <Text style={styles.blockLabel}>{title}</Text>
      <View style={styles.list}>{children}</View>
    </View>
  );
}

function HeroStat({ label, value, tone }) {
  return (
    <View style={styles.heroStat} accessibilityLabel={`${label} ${value}`}>
      <Text
        style={[
          styles.heroStatValue,
          tone === 'red' && styles.valueRed,
          tone === 'green' && styles.valueGreen,
        ]}
      >
        {value}
      </Text>
      <Text style={styles.heroStatLabel}>{label}</Text>
    </View>
  );
}

function StoreDetail({ row, compact }) {
  return (
    <View>
      <View style={styles.hero}>
        <View style={styles.heroTitleRow}>
          <StoreMark name={row.store} size={compact ? 36 : 40} />
          <View style={styles.rowCopy}>
            <Text style={styles.heroName} numberOfLines={1}>
              {row.store}
            </Text>
            <Text style={styles.heroMeta} numberOfLines={1}>
              {formatInsightCount(row.evaluated, 'reviewed purchase')}
            </Text>
          </View>
        </View>
        <View style={styles.heroStats}>
          <HeroStat label="Correct" value={String(row.correct)} tone="green" />
          <HeroStat label="Incorrect" value={String(row.incorrect)} tone={row.incorrect ? 'red' : undefined} />
          <HeroStat label="Accuracy" value={formatInsightPercent(row.accuracy, row.evaluated)} />
        </View>
      </View>

      <SectionBlock title="Employees">
        {row.employees.length ? (
          row.employees.map((person, index) => (
            <InsightRow
              key={person.name}
              compact={compact}
              title={person.name}
              meta={person.types.map((item) => `${item.label} (${item.count})`).join(' · ')}
              value={formatInsightCount(person.incorrect, 'error')}
              valueTone="red"
              last={index === row.employees.length - 1}
            />
          ))
        ) : (
          <Text style={styles.emptyInset}>No incorrect reviews at this store.</Text>
        )}
      </SectionBlock>

      <SectionBlock title="Error types">
        {row.errorTypes.length ? (
          row.errorTypes.map((item, index) => (
            <InsightRow
              key={item.label}
              compact={compact}
              title={item.label}
              value={String(item.count)}
              valueTone="red"
              last={index === row.errorTypes.length - 1}
            />
          ))
        ) : (
          <Text style={styles.emptyInset}>No error types recorded.</Text>
        )}
      </SectionBlock>

      <SectionBlock title="Products" last>
        {row.products.length ? (
          row.products.map((item, index) => (
            <InsightRow
              key={item.label}
              compact={compact}
              title={item.label}
              meta={CountLine(item)}
              value={
                item.incorrect
                  ? formatInsightCount(item.incorrect, 'error')
                  : formatInsightPercent(item.evaluated ? item.correct / item.evaluated : 0, item.evaluated)
              }
              valueTone={item.incorrect ? 'red' : 'green'}
              last={index === row.products.length - 1}
            />
          ))
        ) : (
          <Text style={styles.emptyInset}>No product kinds on reviewed purchases.</Text>
        )}
      </SectionBlock>
    </View>
  );
}

export default function TriageInsightsPanel({ storeFilter = '' }) {
  const isMobile = useIsMobile();
  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setSnapshot(await fetchTriageInsightSnapshot());
    } catch (err) {
      setSnapshot(null);
      setError(err?.message || 'Could not load triage insights.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const active = useMemo(() => insightForStore(snapshot, storeFilter), [snapshot, storeFilter]);

  return (
    <View style={styles.page}>
      <Text style={styles.sectionLabel}>Triage insights</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {loading && !snapshot ? (
        <View style={styles.loading}>
          <ActivityIndicator color="#1d1d1f" />
        </View>
      ) : active ? (
        <StoreDetail row={active} compact={isMobile} />
      ) : (
        <Text style={styles.empty}>
          {storeFilter
            ? `No reviewed purchases at ${storeFilter} yet.`
            : 'No reviewed purchases yet.'}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    minHeight: 0,
    alignSelf: 'stretch',
    width: '100%',
    backgroundColor: CANVAS,
  },
  sectionLabel: {
    fontFamily,
    fontSize: 13,
    fontWeight: '400',
    color: '#8e8e93',
    letterSpacing: -0.08,
    textTransform: 'uppercase',
    paddingHorizontal: MOBILE_FILTER_INSET,
    marginBottom: 8,
  },
  list: {
    backgroundColor: '#fff',
    alignSelf: 'stretch',
  },
  loading: {
    minHeight: 72,
    alignItems: 'center',
    justifyContent: 'center',
  },
  empty: {
    fontFamily,
    fontSize: 15,
    color: '#8e8e93',
    paddingHorizontal: MOBILE_FILTER_INSET,
    paddingVertical: 20,
  },
  emptyInset: {
    fontFamily,
    fontSize: 14,
    color: '#8e8e93',
    paddingHorizontal: MOBILE_FILTER_INSET,
    paddingVertical: 16,
  },
  error: {
    fontFamily,
    fontSize: 14,
    color: '#B91C1C',
    paddingHorizontal: MOBILE_FILTER_INSET,
    paddingBottom: 8,
  },
  deskRow: {
    minHeight: 56,
    backgroundColor: '#fff',
    ...Platform.select({
      web: {
        cursor: 'pointer',
        transitionProperty: 'background-color',
        transitionDuration: '120ms',
        transitionTimingFunction: 'ease',
      },
      default: {},
    }),
  },
  mobileRow: {
    minHeight: 72,
    backgroundColor: '#fff',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  rowHovered: {
    backgroundColor: '#f5f5f5',
  },
  deskRowBody: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingLeft: 16,
    paddingRight: 16,
    minHeight: 56,
  },
  mobileRowBody: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 72,
    paddingLeft: MOBILE_FILTER_INSET,
    paddingRight: MOBILE_FILTER_INSET,
    paddingVertical: 12,
  },
  rowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: DIVIDER,
  },
  headerRow: {
    minHeight: 36,
    backgroundColor: CANVAS,
    ...Platform.select({
      web: { cursor: 'default' },
      default: {},
    }),
  },
  headerRule: {
    minHeight: 36,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: DIVIDER,
  },
  headerText: {
    fontFamily,
    fontSize: 13,
    fontWeight: '400',
    color: '#8e8e93',
    letterSpacing: -0.08,
    textTransform: 'uppercase',
  },
  headerStore: {
    flex: 1.4,
    minWidth: 160,
  },
  headerNum: {
    width: 88,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  rowCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  deskName: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  deskMeta: {
    fontFamily,
    fontSize: 12,
    color: '#8e8e93',
    fontVariant: ['tabular-nums'],
  },
  deskValue: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: '#1a1a1a',
    fontVariant: ['tabular-nums'],
  },
  mobileName: {
    fontFamily,
    fontSize: 16,
    fontWeight: '600',
    color: MOBILE.label,
    letterSpacing: -0.2,
  },
  mobileMeta: {
    fontFamily,
    fontSize: 13,
    color: MOBILE.secondary,
  },
  mobileValue: {
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: MOBILE.label,
    fontVariant: ['tabular-nums'],
  },
  valueRed: {
    color: '#B91C1C',
  },
  valueGreen: {
    color: '#15803D',
  },
  valueMuted: {
    color: '#c7c7cc',
  },
  chevron: {
    width: 14,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  storeMark: {
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  storeMarkEmpty: {
    backgroundColor: '#e5e5ea',
  },
  storeMarkText: {
    fontFamily,
    fontSize: 11,
    fontWeight: '700',
    color: '#fff',
    letterSpacing: 0.2,
  },
  storeMarkTextSm: {
    fontSize: 9,
  },
  hero: {
    paddingHorizontal: MOBILE_FILTER_INSET,
    paddingBottom: 8,
    gap: 16,
  },
  backRow: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    marginLeft: -6,
    paddingVertical: 4,
    paddingRight: 8,
    borderRadius: 8,
  },
  backLabel: {
    fontFamily,
    fontSize: 15,
    fontWeight: '500',
    color: '#1d1d1f',
  },
  heroTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  heroName: {
    fontFamily,
    fontSize: 22,
    fontWeight: '600',
    color: '#1d1d1f',
    letterSpacing: -0.4,
  },
  heroMeta: {
    fontFamily,
    fontSize: 13,
    color: '#8e8e93',
  },
  heroStats: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 20,
  },
  heroStat: {
    minWidth: 72,
    gap: 2,
  },
  heroStatValue: {
    fontFamily,
    fontSize: 22,
    fontWeight: '600',
    color: '#1d1d1f',
    letterSpacing: -0.4,
    fontVariant: ['tabular-nums'],
  },
  heroStatLabel: {
    fontFamily,
    fontSize: 12,
    fontWeight: '500',
    color: '#8e8e93',
  },
  block: {
    marginTop: 20,
  },
  blockLast: {
    paddingBottom: 8,
  },
  blockLabel: {
    fontFamily,
    fontSize: 13,
    fontWeight: '400',
    color: '#8e8e93',
    letterSpacing: -0.08,
    textTransform: 'uppercase',
    paddingHorizontal: MOBILE_FILTER_INSET,
    marginBottom: 8,
  },
});
