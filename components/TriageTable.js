import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Image,
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
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { parseDocReference } from '../lib/transactions';
import { FONT, T } from './TriageKit';

if (Platform.OS === 'web' && typeof document !== 'undefined') {
  const styleId = 'cgold-triage-table-blur';
  let style = document.getElementById(styleId);
  if (!style) {
    style = document.createElement('style');
    style.id = styleId;
    document.head.appendChild(style);
  }
  style.textContent = [
    '.cgold-triage-table-blur{-webkit-backdrop-filter:saturate(180%) blur(18px);backdrop-filter:saturate(180%) blur(18px);background-color:rgba(246,246,249,0.78)!important;}',
    '.cgold-triage-table-row{cursor:pointer;}',
    '.cgold-triage-table-row:hover{background-color:#f5f5f7!important;}',
    '.cgold-triage-table-row.cgold-triage-row-mixed:hover{background-color:rgba(255,149,0,0.26)!important;}',
    '.cgold-triage-table-row.cgold-triage-row-bullion:hover{background-color:rgba(255,59,48,0.26)!important;}',
  ].join('');
}

/** Row height used for FlatList layout hints; keep in sync with styles.tableRow. */
export const TABLE_ROW_HEIGHT = 46;
const HEADER_FALLBACK_HEIGHT = 32;
const TOOLBAR_FALLBACK_HEIGHT = 34;

/**
 * Human label for a set of PO/SO rows: "PO", "SO", or "PO / SO" when mixed.
 * `count` controls pluralisation ("3 POs", "1 SO", "4 PO / SO").
 */
export function docNoun(rows, count) {
  let po = 0;
  let so = 0;
  for (const row of rows || []) {
    if (row?.type === 'purchase') po += 1;
    else if (row?.type === 'order' || row?.type === 'sale') so += 1;
    else po += 1;
  }
  const n = count == null ? po + so : count;
  if (po && !so) return n === 1 ? 'PO' : 'POs';
  if (so && !po) return n === 1 ? 'SO' : 'SOs';
  return 'PO / SO';
}

const fontFamily = FONT;

const TEXT = T.text;
const SECONDARY = T.secondary;
const FILL = T.fill;
const HAIRLINE = '#e5e5ea';
const BLUE = T.blue;

export function uniqueLabels(values) {
  const seen = new Set();
  const out = [];
  for (const raw of values) {
    const label = String(raw || '').trim();
    if (!label || label === '—') continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(label);
  }
  return out.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

export function selectedLabels(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || '').trim()).filter(Boolean);
  }
  const label = String(value || '').trim();
  return label ? [label] : [];
}

export function matchesSelectedLabel(value, selected) {
  const list = selectedLabels(selected);
  if (!list.length) return true;
  const needle = String(value || '')
    .trim()
    .toLowerCase();
  if (!needle) return false;
  return list.some((item) => item.toLowerCase() === needle);
}

export function rowPersonLabels(row) {
  return uniqueLabels([row?.customerName, row?.employeeName]);
}

export function matchesLabelFilter(value, query) {
  const q = String(query || '')
    .trim()
    .toLowerCase();
  if (!q) return true;
  return String(value || '')
    .toLowerCase()
    .includes(q);
}

export function matchesPersonFilter(row, query) {
  const q = String(query || '').trim();
  if (!q) return true;
  return rowPersonLabels(row).some((label) => matchesLabelFilter(label, q));
}

export function matchesDocQuery(row, query) {
  const q = String(query || '').trim();
  if (!q) return true;
  if (!row) return false;
  const parsed = parseDocReference(q);
  const digits = q.replace(/[^\d]/g, '');
  if (parsed && String(row.sourceId) === parsed.sourceId) {
    if (parsed.type === 'purchase') return row.type === 'purchase';
    if (parsed.type === 'order') return row.type === 'order';
    return true;
  }
  if (digits && String(row.sourceId || '').includes(digits)) return true;
  const hay = [row.reference, row.sourceId, row.customerName, row.employeeName, row.storeName, row.dateLabel]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return hay.includes(q.toLowerCase());
}

export function TableCell({ children, flex = 1, minWidth = 88, width, last, align = 'left' }) {
  const alignStyle = align === 'right' ? styles.tableCellRight : null;
  return (
    <View
      style={[
        styles.tableCell,
        width ? { width, flexGrow: 0, flexShrink: 0 } : { flex, minWidth },
        last && styles.tableCellLast,
        alignStyle,
      ]}
    >
      {typeof children === 'string' || children == null ? (
        <Text
          style={[styles.tableCellText, align === 'right' && styles.tableCellTextRight]}
          numberOfLines={1}
        >
          {children || '—'}
        </Text>
      ) : (
        children
      )}
    </View>
  );
}

export function TableStrong({ children, align }) {
  return (
    <Text style={[styles.tableCellStrong, align === 'right' && styles.tableCellTextRight]} numberOfLines={1}>
      {children || '—'}
    </Text>
  );
}

const STATUS_TONES = {
  neutral: T.secondary,
  blue: T.blue,
  green: '#248A3D',
  orange: '#C93400',
  red: '#D70015',
};

/** Compact status text with a leading dot, coloured by tone. */
export function TableStatus({ label, tone = 'neutral', sub }) {
  const color = STATUS_TONES[tone] || STATUS_TONES.neutral;
  return (
    <View>
      <View style={styles.statusRow}>
        <View style={[styles.statusDot, { backgroundColor: color }]} />
        <Text style={[styles.statusText, { color }]} numberOfLines={1}>
          {label}
        </Text>
      </View>
      {sub ? <TableMuted>{sub}</TableMuted> : null}
    </View>
  );
}

/** Sort a list of rows by a string/number getter and direction. */
export function sortRows(rows, getValue, dir) {
  if (!dir || !getValue) return rows;
  const sign = dir === 'desc' ? -1 : 1;
  return [...rows].sort((a, b) => {
    const av = getValue(a);
    const bv = getValue(b);
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * sign;
    return String(av).localeCompare(String(bv), undefined, { sensitivity: 'base', numeric: true }) * sign;
  });
}

export function TablePhotoCell({ children }) {
  return <View style={styles.tablePhotoCell}>{children}</View>;
}

export function TableRowPressable({ last, onPress, accessibilityLabel, children }) {
  return (
    <Pressable
      style={[styles.tableRow, last && styles.tableRowLast]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      {...(Platform.OS === 'web' ? { className: 'cgold-triage-row' } : null)}
    >
      {children}
    </Pressable>
  );
}

export function TableRow({ last, children, style, webClassName }) {
  return (
    <View
      style={[styles.tableRow, last && styles.tableRowLast, style]}
      {...(Platform.OS === 'web'
        ? { className: ['cgold-triage-table-row', webClassName].filter(Boolean).join(' ') }
        : null)}
    >
      {children}
    </View>
  );
}

export function TableRowMain({ onPress, accessibilityLabel, children }) {
  return (
    <Pressable
      style={({ hovered, pressed }) => [
        styles.tableRowMain,
        (hovered || pressed) && styles.tableRowMainHover,
      ]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      {...(Platform.OS === 'web' ? { className: 'cgold-triage-row' } : null)}
    >
      {children}
    </Pressable>
  );
}

export function TableActions({ children }) {
  return <View style={styles.tableActions}>{children}</View>;
}

export function TableActionsHead() {
  return <View style={styles.tableActionsHead} />;
}

export function TableDeleteButton({ onPress, label }) {
  return (
    <Pressable
      style={styles.tableDelete}
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={label || 'Delete'}
    >
      <Text style={styles.tableDeleteText}>Delete</Text>
    </Pressable>
  );
}

export function TableMuted({ children }) {
  return (
    <Text style={styles.tableCellMuted} numberOfLines={1}>
      {children}
    </Text>
  );
}

export function TableToolbar({ children }) {
  return <View style={styles.tableToolbar}>{children}</View>;
}

export function TableMeta({ children }) {
  return <Text style={styles.tableMeta}>{children}</Text>;
}

export function TableEmpty({ children }) {
  return <Text style={styles.tableEmpty}>{children}</Text>;
}

/**
 * Table shell: a blurred, sticky filter bar (optional toolbar line + column
 * headers) floating over a virtualized body. Pass `data`/`renderItem` for the
 * FlatList path, or `children` for small static tables.
 */
export function TableFrame({
  minWidth,
  header,
  toolbar,
  data,
  renderItem,
  keyExtractor,
  ListEmptyComponent,
  children,
  extraData,
}) {
  const { width } = useWindowDimensions();
  const [chromeHeight, setChromeHeight] = useState(
    HEADER_FALLBACK_HEIGHT + (toolbar ? TOOLBAR_FALLBACK_HEIGHT : 0),
  );
  const onChromeLayout = useCallback((event) => {
    const next = Math.ceil(event.nativeEvent.layout.height);
    if (next > 0) setChromeHeight((current) => (current === next ? current : next));
  }, []);
  const getItemLayout = useCallback(
    (_, index) => ({ length: TABLE_ROW_HEIGHT, offset: TABLE_ROW_HEIGHT * index, index }),
    [],
  );
  const bodyPad = useMemo(() => ({ paddingTop: chromeHeight }), [chromeHeight]);

  const chrome = (
    <BlurView
      intensity={60}
      tint="light"
      style={styles.tableChrome}
      onLayout={onChromeLayout}
      {...(Platform.OS === 'web' ? { className: 'cgold-triage-table-blur' } : null)}
    >
      {toolbar ? <View style={styles.tableToolbarInner}>{toolbar}</View> : null}
      <View style={styles.tableHeader}>{header}</View>
    </BlurView>
  );

  const inner = (
    <View style={[styles.tableCard, { minWidth }]}>
      {Array.isArray(data) ? (
        <FlatList
          style={styles.tableBody}
          contentContainerStyle={[styles.tableBodyContent, bodyPad]}
          data={data}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          extraData={extraData}
          ListEmptyComponent={ListEmptyComponent}
          getItemLayout={getItemLayout}
          initialNumToRender={18}
          maxToRenderPerBatch={16}
          windowSize={7}
          removeClippedSubviews={Platform.OS !== 'web'}
          keyboardShouldPersistTaps="handled"
          nestedScrollEnabled
        />
      ) : (
        <ScrollView
          style={styles.tableBody}
          contentContainerStyle={[styles.tableBodyContent, bodyPad]}
          nestedScrollEnabled
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
      )}
      {chrome}
    </View>
  );

  if (width < minWidth + 48) {
    return (
      <ScrollView
        horizontal
        style={styles.tableHScroll}
        contentContainerStyle={styles.tableHContent}
        showsHorizontalScrollIndicator={false}
      >
        {inner}
      </ScrollView>
    );
  }

  return <View style={[styles.tableHContent, styles.tableHFill]}>{inner}</View>;
}

export function ColumnFilter({
  columnKey,
  label,
  value,
  onChange,
  options,
  openKey,
  onOpenKey,
  style,
  align = 'start',
  sortDir,
  onSort,
  sortOnly = false,
}) {
  const open = openKey === columnKey;
  const [query, setQuery] = useState('');
  const selected = selectedLabels(value);
  const active = selected.length > 0;
  const sorted = Boolean(sortDir);
  const handleChange = onChange || (() => {});

  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = options || [];
    if (!q) return list.slice(0, 60);
    return list.filter((option) => option.toLowerCase().includes(q)).slice(0, 60);
  }, [options, query]);

  const toggle = (option) => {
    const key = String(option || '')
      .trim()
      .toLowerCase();
    if (!key) return;
    const exists = selected.some((item) => item.toLowerCase() === key);
    handleChange(exists ? selected.filter((item) => item.toLowerCase() !== key) : [...selected, option]);
  };

  return (
    <View style={[styles.colFilter, style]}>
      <Pressable
        style={[styles.colFilterHit, open && styles.colFilterHitOpen]}
        onPress={() => onOpenKey(open ? null : columnKey)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open, selected: active }}
        accessibilityLabel={
          active ? `${label} filter, ${selected.length} selected` : `Filter ${label}`
        }
      >
        <Text
          style={[styles.colFilterLabel, (active || sorted) && styles.colFilterLabelOn]}
          numberOfLines={1}
        >
          {label}
        </Text>
        {active ? <View style={styles.colFilterBadge}><Text style={styles.colFilterBadgeText}>{selected.length}</Text></View> : null}
        <Ionicons
          name={sorted ? (sortDir === 'desc' ? 'arrow-down' : 'arrow-up') : 'chevron-down'}
          size={11}
          color={active || open || sorted ? BLUE : SECONDARY}
        />
      </Pressable>
      {open ? (
        <View
          style={[styles.colFilterMenu, align === 'end' ? { left: 'auto', right: 4 } : null]}
        >
          <View style={styles.colFilterMenuHead}>
            <Text style={styles.colFilterMenuTitle}>{label}</Text>
            {active ? (
              <Pressable
                onPress={() => handleChange([])}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={`Clear ${label} filter`}
              >
                <Text style={styles.colFilterClear}>Clear</Text>
              </Pressable>
            ) : null}
          </View>
          {onSort ? (
            <View style={styles.colFilterSortRow}>
              {[
                { dir: 'asc', label: 'A → Z', icon: 'arrow-up' },
                { dir: 'desc', label: 'Z → A', icon: 'arrow-down' },
              ].map((option) => {
                const on = sortDir === option.dir;
                return (
                  <Pressable
                    key={option.dir}
                    style={[styles.colFilterSort, on && styles.colFilterSortOn]}
                    onPress={() => onSort(on ? null : option.dir)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    accessibilityLabel={`Sort ${label} ${option.label}`}
                  >
                    <Ionicons name={option.icon} size={12} color={on ? '#fff' : TEXT} />
                    <Text style={[styles.colFilterSortText, on && styles.colFilterSortTextOn]}>
                      {option.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          ) : null}
          {sortOnly ? (
            <View style={styles.colFilterSortSpacer} />
          ) : (
            <>
              <View style={styles.colFilterSearch}>
                <Ionicons name="search" size={15} color={SECONDARY} />
                <TextInput
                  style={styles.colFilterInput}
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Search"
                  placeholderTextColor={SECONDARY}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>
              <ScrollView
                style={styles.colFilterList}
                keyboardShouldPersistTaps="handled"
                nestedScrollEnabled
              >
                {results.length === 0 ? (
                  <Text style={styles.colFilterEmpty}>
                    {query.trim() ? 'No matching values' : 'No values'}
                  </Text>
                ) : (
                  results.map((option) => {
                    const on = selected.some((item) => item.toLowerCase() === option.toLowerCase());
                    return (
                      <Pressable
                        key={option}
                        style={styles.colFilterOption}
                        onPress={() => toggle(option)}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: on }}
                      >
                        <Ionicons
                          name={on ? 'checkmark-circle' : 'ellipse-outline'}
                          size={22}
                          color={on ? BLUE : '#C7C7CC'}
                        />
                        <Text
                          style={[styles.colFilterOptionText, on && styles.colFilterOptionOn]}
                          numberOfLines={1}
                        >
                          {option}
                        </Text>
                      </Pressable>
                    );
                  })
                )}
              </ScrollView>
            </>
          )}
          <Pressable
            style={styles.colFilterDone}
            onPress={() => onOpenKey(null)}
            accessibilityRole="button"
            accessibilityLabel="Done"
          >
            <Text style={styles.colFilterDoneText}>Done</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

export const PoThumb = memo(function PoThumb({ urls, label }) {
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const photos = Array.isArray(urls) ? urls.filter(Boolean) : [];
  const firstPhoto = photos[0];

  useEffect(() => {
    setFailed(false);
  }, [firstPhoto]);

  if (!photos.length || failed) {
    return (
      <View style={styles.poThumbSlot}>
        <Ionicons name="image-outline" size={16} color={SECONDARY} />
      </View>
    );
  }

  return (
    <>
      <View
        accessibilityRole="image"
        accessibilityLabel={`View photo for ${label}`}
        style={styles.poThumbPress}
        {...(Platform.OS === 'web'
          ? {
              onClick: (event) => {
                event?.stopPropagation?.();
                setOpen(true);
              },
            }
          : {
              onTouchEnd: (event) => {
                event?.stopPropagation?.();
                setOpen(true);
              },
            })}
      >
        <Image
          source={{ uri: photos[0] }}
          style={styles.poThumb}
          resizeMode="cover"
          onError={() => setFailed(true)}
        />
      </View>
      {open ? (
        <Modal visible transparent animationType="fade" onRequestClose={() => setOpen(false)}>
          <View style={styles.photoViewerRoot}>
            <Pressable style={StyleSheet.absoluteFill} onPress={() => setOpen(false)} />
            <View style={styles.photoViewerSheet} pointerEvents="box-none">
              <View style={styles.photoViewerBar}>
                <Text style={styles.photoViewerTitle} numberOfLines={1}>
                  {label}
                </Text>
                <Pressable onPress={() => setOpen(false)} hitSlop={8} accessibilityLabel="Close photo">
                  <Ionicons name="close" size={20} color={TEXT} />
                </Pressable>
              </View>
              <Image source={{ uri: photos[0] }} style={styles.photoViewerImage} resizeMode="contain" />
            </View>
          </View>
        </Modal>
      ) : null}
    </>
  );
});

const styles = StyleSheet.create({
  tableToolbar: {
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 8,
    minHeight: 36,
  },
  tableMeta: {
    fontFamily,
    fontSize: 13,
    fontWeight: '400',
    color: SECONDARY,
  },
  tableHScroll: {
    flex: 1,
    minHeight: 0,
  },
  tableHContent: {
    flexGrow: 1,
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  tableHFill: {
    flex: 1,
    minHeight: 0,
  },
  tableCard: {
    flex: 1,
    minHeight: 0,
    backgroundColor: '#fff',
    borderRadius: 12,
    overflow: 'visible',
    ...Platform.select({
      web: { boxShadow: '0 1px 2px rgba(0,0,0,0.04)' },
      default: {},
    }),
  },
  tableChrome: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 8,
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#d1d1d6',
    backgroundColor: 'rgba(246,246,249,0.9)',
  },
  tableToolbarInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    minHeight: 34,
    paddingLeft: 14,
    paddingRight: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(60,60,67,0.12)',
  },
  tableHeader: {
    flexDirection: 'row',
    alignItems: 'stretch',
    minHeight: 32,
    overflow: 'visible',
  },
  tableBody: {
    flex: 1,
    minHeight: 0,
  },
  tableBodyContent: {
    flexGrow: 1,
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    height: TABLE_ROW_HEIGHT,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: HAIRLINE,
    backgroundColor: '#fff',
  },
  tableRowHover: {
    backgroundColor: '#f5f5f7',
  },
  tableRowMainHover: {
    backgroundColor: '#f5f5f7',
  },
  tableRowLast: {
    borderBottomWidth: 0,
    borderBottomLeftRadius: 12,
    borderBottomRightRadius: 12,
  },
  tableRowMain: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  tableCell: {
    height: TABLE_ROW_HEIGHT,
    paddingHorizontal: 8,
    justifyContent: 'center',
  },
  tableCellLast: {
    paddingRight: 14,
  },
  tableCellRight: {
    alignItems: 'flex-end',
  },
  tableCellText: {
    fontFamily,
    fontSize: 13,
    color: TEXT,
    letterSpacing: -0.08,
  },
  tableCellTextRight: {
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  statusText: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: -0.08,
  },
  colFilterBadge: {
    minWidth: 16,
    height: 16,
    paddingHorizontal: 4,
    borderRadius: 8,
    backgroundColor: BLUE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  colFilterBadgeText: {
    fontFamily,
    fontSize: 10,
    fontWeight: '700',
    color: '#fff',
  },
  colFilterSortRow: {
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 10,
    paddingTop: 8,
  },
  colFilterSortSpacer: {
    height: 8,
  },
  colFilterSort: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    height: 30,
    borderRadius: 8,
    backgroundColor: FILL,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  colFilterSortOn: {
    backgroundColor: BLUE,
  },
  colFilterSortText: {
    fontFamily,
    fontSize: 12,
    fontWeight: '600',
    color: TEXT,
  },
  colFilterSortTextOn: {
    color: '#fff',
  },
  tableCellStrong: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: TEXT,
    letterSpacing: -0.08,
  },
  tableCellMuted: {
    fontFamily,
    fontSize: 11.5,
    color: SECONDARY,
    marginTop: 0,
  },
  tableActions: {
    width: 64,
    flexGrow: 0,
    flexShrink: 0,
    alignItems: 'flex-end',
    justifyContent: 'center',
    paddingRight: 10,
  },
  tableActionsHead: {
    width: 64,
    flexGrow: 0,
    flexShrink: 0,
  },
  tableDelete: {
    minHeight: 32,
    justifyContent: 'center',
    paddingHorizontal: 4,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  tableDeleteText: {
    fontFamily,
    fontSize: 14,
    fontWeight: '400',
    color: '#FF3B30',
  },
  tablePhotoCell: {
    width: 46,
    flexGrow: 0,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingLeft: 8,
  },
  tableEmpty: {
    fontFamily,
    fontSize: 13,
    color: SECONDARY,
    textAlign: 'center',
    paddingVertical: 32,
    paddingHorizontal: 16,
  },
  colFilter: {
    justifyContent: 'center',
    zIndex: 8,
    overflow: 'visible',
  },
  colFilterHit: {
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  colFilterHitOpen: {
    backgroundColor: 'rgba(0, 122, 255, 0.08)',
  },
  colFilterLabel: {
    fontFamily,
    flexShrink: 1,
    fontSize: 11,
    fontWeight: '600',
    color: SECONDARY,
    letterSpacing: 0.2,
    textTransform: 'uppercase',
  },
  colFilterLabelOn: {
    color: BLUE,
  },
  colFilterMenu: {
    position: 'absolute',
    top: 34,
    left: 4,
    width: 248,
    backgroundColor: 'rgba(255,255,255,0.96)',
    borderRadius: 14,
    overflow: 'hidden',
    zIndex: 40,
    ...Platform.select({
      web: { boxShadow: '0 12px 40px rgba(0,0,0,0.18)', backdropFilter: 'blur(20px)' },
      default: { elevation: 8 },
    }),
  },
  colFilterMenuHead: {
    minHeight: 40,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: HAIRLINE,
  },
  colFilterMenuTitle: {
    fontFamily,
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    color: TEXT,
    letterSpacing: -0.08,
  },
  colFilterSearch: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginHorizontal: 10,
    marginTop: 8,
    marginBottom: 4,
    paddingHorizontal: 10,
    minHeight: 34,
    borderRadius: 10,
    backgroundColor: FILL,
  },
  colFilterInput: {
    flex: 1,
    minWidth: 0,
    fontFamily,
    fontSize: 15,
    color: TEXT,
    paddingVertical: 6,
    outlineStyle: 'none',
  },
  colFilterList: {
    maxHeight: 220,
  },
  colFilterOption: {
    minHeight: 40,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  colFilterOptionText: {
    fontFamily,
    flex: 1,
    fontSize: 15,
    color: TEXT,
    letterSpacing: -0.2,
  },
  colFilterOptionOn: {
    fontWeight: '600',
  },
  colFilterClear: {
    fontFamily,
    fontSize: 15,
    fontWeight: '400',
    color: BLUE,
  },
  colFilterDone: {
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: HAIRLINE,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  colFilterDoneText: {
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: BLUE,
  },
  colFilterEmpty: {
    fontFamily,
    fontSize: 13,
    color: SECONDARY,
    textAlign: 'center',
    paddingVertical: 18,
  },
  poThumbSlot: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: FILL,
    alignItems: 'center',
    justifyContent: 'center',
  },
  poThumbPress: {
    width: 36,
    height: 36,
    borderRadius: 8,
    overflow: 'hidden',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  poThumb: {
    width: 36,
    height: 36,
    backgroundColor: FILL,
  },
  photoViewerRoot: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  photoViewerSheet: {
    width: '100%',
    maxWidth: 720,
    gap: 12,
  },
  photoViewerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  photoViewerTitle: {
    flex: 1,
    fontFamily,
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  photoViewerImage: {
    width: '100%',
    height: 420,
    backgroundColor: '#111',
    borderRadius: 10,
  },
});
