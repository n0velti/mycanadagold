import { useMemo, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  createSortedRowModel,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_basic,
  tableFeatures,
  useTable,
} from '@tanstack/react-table';
import { formatMeasure } from '../lib/employeeMetrics';
import { parseDocReference } from '../lib/transactions';
import { CANVAS, NAV_TAB_ACTIVE_BG, NAV_TAB_ACTIVE_RADIUS } from '../lib/mobileUi';
import { FONT } from '../lib/typography';

const INK = '#1a1a1a';
const MUTED = '#8e8e93';
const RULE = 'rgba(42,38,30,0.08)';

// Static per the TanStack docs: features are stitched in once, not per render.
const FEATURES = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: { alphanumeric: sortFn_alphanumeric, basic: sortFn_basic },
});

const NUMBER_FORMATS = new Set(['int', 'decimal', 'money', 'hours', 'percent']);

function cellText(value, format) {
  if (value == null || value === '') return '—';
  if (NUMBER_FORMATS.has(format) && Number.isFinite(Number(value))) return formatMeasure(Number(value), format);
  return String(value);
}

function columnWidth(column, rows) {
  const longest = Math.max(
    String(column.label || '').length,
    ...rows.map((row) => cellText(row[column.key], column.format).length),
  );
  const isNumber = NUMBER_FORMATS.has(column.format);
  const base = Math.min(Math.max(longest * 7.5 + 28, isNumber ? 84 : 110), 280);
  return Math.round(base);
}

export default function AnalyticsTableCard({ chart, onOpenTicket }) {
  const [sorting, setSorting] = useState([]);
  const rows = useMemo(() => (Array.isArray(chart?.rows) ? chart.rows : []), [chart]);

  const columns = useMemo(() => {
    const defs = Array.isArray(chart?.columns) ? chart.columns : [];
    return defs.map((column) => ({
      id: column.key,
      accessorFn: (row) => row[column.key],
      header: column.label,
      sortFn: NUMBER_FORMATS.has(column.format) ? 'basic' : 'alphanumeric',
      sortDescFirst: NUMBER_FORMATS.has(column.format),
      meta: { format: column.format, width: columnWidth(column, rows) },
    }));
  }, [chart, rows]);

  const table = useTable(
    {
      features: FEATURES,
      columns,
      data: rows,
      state: { sorting },
      onSortingChange: setSorting,
    },
    (state) => ({ sorting: state.sorting }),
  );

  if (!chart || !columns.length) return null;

  const headerGroups = table.getHeaderGroups();
  const bodyRows = table.getRowModel().rows;
  const footer = chart.footer && typeof chart.footer === 'object' ? chart.footer : null;

  return (
    <View style={styles.card}>
      <Text style={styles.title}>{chart.title}</Text>
      {chart.subtitle ? <Text style={styles.subtitle}>{chart.subtitle}</Text> : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <View>
          {headerGroups.map((group) => (
            <View key={group.id} style={[styles.row, styles.headRow]}>
              {group.headers.map((header) => {
                const column = header.column;
                const meta = column.columnDef.meta || {};
                const sorted = column.getIsSorted();
                const numeric = NUMBER_FORMATS.has(meta.format);
                return (
                  <Pressable
                    key={header.id}
                    onPress={column.getToggleSortingHandler()}
                    accessibilityRole="button"
                    accessibilityLabel={`Sort by ${column.columnDef.header}`}
                    style={({ hovered, pressed }) => [
                      styles.cell,
                      styles.headCell,
                      { width: meta.width },
                      numeric && styles.cellRight,
                      (hovered || pressed) && styles.headCellHover,
                    ]}
                  >
                    <Text style={[styles.headText, sorted && styles.headTextOn]} numberOfLines={1}>
                      {column.columnDef.header}
                    </Text>
                    {sorted ? (
                      <Ionicons name={sorted === 'desc' ? 'arrow-down' : 'arrow-up'} size={11} color={INK} />
                    ) : null}
                  </Pressable>
                );
              })}
            </View>
          ))}
          {bodyRows.map((row, index) => (
            <View key={row.id} style={[styles.row, index % 2 === 1 && styles.rowAlt]}>
              {row.getAllCells().map((cell) => {
                const meta = cell.column.columnDef.meta || {};
                const numeric = NUMBER_FORMATS.has(meta.format);
                const value = cell.getValue();
                const ticket = onOpenTicket && meta.format === 'text' ? parseDocReference(value) : null;
                return (
                  <View key={cell.id} style={[styles.cell, { width: meta.width }, numeric && styles.cellRight]}>
                    {ticket ? (
                      <Pressable
                        onPress={() => onOpenTicket(ticket)}
                        accessibilityRole="link"
                        accessibilityLabel={`Open ${ticket.reference}`}
                        style={({ hovered, pressed }) => [(hovered || pressed) && styles.ticketPressed]}
                      >
                        <Text style={[styles.cellText, styles.ticketText]} numberOfLines={1}>
                          {cellText(value, meta.format)}
                        </Text>
                      </Pressable>
                    ) : (
                      <Text selectable style={[styles.cellText, numeric && styles.cellTextNumber]} numberOfLines={2}>
                        {cellText(value, meta.format)}
                      </Text>
                    )}
                  </View>
                );
              })}
            </View>
          ))}
          {footer ? (
            <View style={[styles.row, styles.footRow]}>
              {columns.map((column) => {
                const meta = column.meta || {};
                const numeric = NUMBER_FORMATS.has(meta.format);
                const value = footer[column.id];
                return (
                  <View key={column.id} style={[styles.cell, { width: meta.width }, numeric && styles.cellRight]}>
                    <Text style={[styles.cellText, styles.footText, numeric && styles.cellTextNumber]} numberOfLines={1}>
                      {value == null || value === '' ? '' : cellText(value, meta.format)}
                    </Text>
                  </View>
                );
              })}
            </View>
          ) : null}
        </View>
      </ScrollView>
      {chart.note ? <Text style={styles.note}>{chart.note}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    alignSelf: 'stretch',
    marginTop: 8,
    paddingTop: 12,
    paddingBottom: 6,
    borderRadius: NAV_TAB_ACTIVE_RADIUS,
    borderWidth: 1,
    borderColor: '#d0d0d0',
    backgroundColor: CANVAS,
    overflow: 'hidden',
  },
  title: {
    fontFamily: FONT,
    fontSize: 14,
    fontWeight: '500',
    color: INK,
    paddingHorizontal: 14,
    marginBottom: 2,
  },
  subtitle: {
    fontFamily: FONT,
    fontSize: 12,
    lineHeight: 16,
    color: '#6e6e73',
    paddingHorizontal: 14,
    marginBottom: 8,
  },
  scroll: {
    minWidth: '100%',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'stretch',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: RULE,
  },
  rowAlt: {
    backgroundColor: 'rgba(60, 60, 67, 0.025)',
  },
  headRow: {
    borderTopWidth: 0,
    borderBottomWidth: 1,
    borderBottomColor: '#d0d0d0',
  },
  footRow: {
    borderTopWidth: 1,
    borderTopColor: '#d0d0d0',
    backgroundColor: NAV_TAB_ACTIVE_BG,
  },
  cell: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 8,
    minHeight: 36,
  },
  cellRight: {
    justifyContent: 'flex-end',
  },
  headCell: {
    paddingVertical: 7,
    ...Platform.select({ web: { cursor: 'pointer' }, default: {} }),
  },
  headCellHover: {
    backgroundColor: NAV_TAB_ACTIVE_BG,
  },
  headText: {
    fontFamily: FONT,
    fontSize: 11,
    fontWeight: '500',
    color: MUTED,
    letterSpacing: 0.2,
    textTransform: 'uppercase',
  },
  headTextOn: {
    color: INK,
  },
  cellText: {
    fontFamily: FONT,
    fontSize: 13,
    lineHeight: 18,
    color: INK,
  },
  cellTextNumber: {
    fontVariant: ['tabular-nums'],
    textAlign: 'right',
  },
  footText: {
    fontWeight: '600',
  },
  ticketText: {
    fontWeight: '500',
    textDecorationLine: 'underline',
    ...Platform.select({ web: { cursor: 'pointer', textUnderlineOffset: 2 }, default: {} }),
  },
  ticketPressed: {
    opacity: 0.6,
  },
  note: {
    fontFamily: FONT,
    fontSize: 12,
    lineHeight: 16,
    color: MUTED,
    paddingHorizontal: 14,
    paddingTop: 8,
  },
});
