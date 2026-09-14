import { useEffect, useMemo, useState } from 'react';
import {
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
import { Ionicons } from '@expo/vector-icons';
import { parseDocReference } from '../lib/transactions';
import { MOBILE } from '../lib/mobileUi';

const fontFamily = Platform.select({
  ios: 'Sohne',
  android: 'Sohne',
  default: 'Sohne',
});

const TEXT = '#1d1d1f';
const SECONDARY = '#8e8e93';
const FILL = '#e8e8ed';
const HAIRLINE = '#e5e5ea';
const BLUE = MOBILE.blue;

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

export function TableCell({ children, flex = 1, minWidth = 88, width, last }) {
  return (
    <View
      style={[
        styles.tableCell,
        width ? { width, flexGrow: 0, flexShrink: 0 } : { flex, minWidth },
        last && styles.tableCellLast,
      ]}
    >
      {typeof children === 'string' || children == null ? (
        <Text style={styles.tableCellText} numberOfLines={1}>
          {children || '—'}
        </Text>
      ) : (
        children
      )}
    </View>
  );
}

export function TableStrong({ children }) {
  return (
    <Text style={styles.tableCellStrong} numberOfLines={1}>
      {children || '—'}
    </Text>
  );
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

export function TableRow({ last, children }) {
  return <View style={[styles.tableRow, last && styles.tableRowLast]}>{children}</View>;
}

export function TableRowMain({ onPress, accessibilityLabel, children }) {
  return (
    <Pressable
      style={styles.tableRowMain}
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

export function TableFrame({ minWidth, header, children }) {
  const { width } = useWindowDimensions();
  const inner = (
    <View style={[styles.tableCard, { minWidth }]}>
      <View style={styles.tableHeader}>{header}</View>
      <ScrollView
        style={styles.tableBody}
        contentContainerStyle={styles.tableBodyContent}
        nestedScrollEnabled
        keyboardShouldPersistTaps="handled"
      >
        {children}
      </ScrollView>
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
}) {
  const open = openKey === columnKey;
  const [query, setQuery] = useState('');
  const selected = selectedLabels(value);
  const active = selected.length > 0;

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
    onChange(exists ? selected.filter((item) => item.toLowerCase() !== key) : [...selected, option]);
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
        <Text style={[styles.colFilterLabel, active && styles.colFilterLabelOn]} numberOfLines={1}>
          {label}
        </Text>
        <Ionicons
          name={active ? 'funnel' : 'chevron-down'}
          size={11}
          color={active || open ? BLUE : SECONDARY}
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
                onPress={() => onChange([])}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={`Clear ${label} filter`}
              >
                <Text style={styles.colFilterClear}>Clear</Text>
              </Pressable>
            ) : null}
          </View>
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

export function PoThumb({ urls, label }) {
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const photos = Array.isArray(urls) ? urls.filter(Boolean) : [];

  useEffect(() => {
    setFailed(false);
  }, [photos[0]]);

  if (!photos.length || failed) {
    return (
      <View style={styles.poThumbSlot}>
        <Ionicons name="image-outline" size={16} color={SECONDARY} />
      </View>
    );
  }

  return (
    <>
      <Pressable
        onPress={(event) => {
          event?.stopPropagation?.();
          setOpen(true);
        }}
        style={styles.poThumbPress}
        accessibilityRole="button"
        accessibilityLabel={`View photo for ${label}`}
      >
        <Image
          source={{ uri: photos[0] }}
          style={styles.poThumb}
          resizeMode="cover"
          onError={() => setFailed(true)}
        />
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
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
    </>
  );
}

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
  tableHeader: {
    flexDirection: 'row',
    alignItems: 'stretch',
    minHeight: 36,
    backgroundColor: '#f2f2f7',
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#d1d1d6',
    zIndex: 8,
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
    minHeight: 52,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: HAIRLINE,
    backgroundColor: '#fff',
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
    minHeight: 52,
    paddingHorizontal: 8,
    justifyContent: 'center',
  },
  tableCellLast: {
    paddingRight: 14,
  },
  tableCellText: {
    fontFamily,
    fontSize: 13,
    color: TEXT,
    letterSpacing: -0.08,
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
    fontSize: 12,
    color: SECONDARY,
    marginTop: 1,
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
    fontSize: 15,
    fontWeight: '400',
    color: '#FF3B30',
  },
  tablePhotoCell: {
    width: 52,
    flexGrow: 0,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingLeft: 8,
  },
  tableEmpty: {
    fontFamily,
    fontSize: 14,
    color: SECONDARY,
    textAlign: 'center',
    paddingVertical: 36,
    paddingHorizontal: 16,
  },
  colFilter: {
    justifyContent: 'center',
    zIndex: 8,
    overflow: 'visible',
  },
  colFilterHit: {
    minHeight: 36,
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
    fontSize: 12,
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
    top: 38,
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
    width: 44,
    height: 44,
    borderRadius: 8,
    backgroundColor: FILL,
    alignItems: 'center',
    justifyContent: 'center',
  },
  poThumbPress: {
    width: 44,
    height: 44,
    borderRadius: 8,
    overflow: 'hidden',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  poThumb: {
    width: 44,
    height: 44,
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
