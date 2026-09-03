import { createElement, Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BlurView } from 'expo-blur';
import { useFonts } from 'expo-font';
import * as ImagePicker from 'expo-image-picker';
import { StatusBar } from 'expo-status-bar';
import {
  ActivityIndicator,
  Animated,
  Easing,
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
import { FlashList } from '@shopify/flash-list';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import {
  login as loginRequest,
  logout as logoutRequest,
  onSessionRevoked,
  restoreSession,
} from './lib/auth';
import {
  DEFAULT_APPS_VIEW,
  loadAppsView,
  loadPinnedTools,
  persistAppsView,
  persistPinnedTools,
  storeLocationFromSession,
  isRestrictedHomeEmployee,
  allocatedStoreName,
  filterRowsToAllocatedStore,
  uploadOwnAvatar,
} from './lib/profiles';
import {
  AppAccessContext,
  canManageAppAccess,
  categoryLabel,
  loadRoleAppAccess,
  useAppAccess,
  visibleAppKeysForProfile,
} from './lib/permissions';
import { clearInventoryCache, prefetchInventoryMatrix } from './lib/inventory';
import {
  buildEmailCaptureByStore,
  defaultDateRange,
  fetchHomeStoreSummaries,
  fetchTransactionDetail,
  fetchTransactions,
  FINTRAC_CASH_THRESHOLD,
  formatAmount,
  formatDateParam,
  formatPickerDate,
  isFintracCash,
  needsPaymentEnrichment,
  parseDateParam,
  withPaymentBreakdown,
} from './lib/transactions';
import { readRipplingOAuthCallback } from './lib/rippling';
import AiScreen from './components/AiScreen';
import AccountingScreen from './components/AccountingScreen';
import AuditScreen from './components/AuditScreen';
import BonusesScreen from './components/BonusesScreen';
import EmployeesScreen from './components/EmployeesScreen';
import FinancialsScreen from './components/FinancialsScreen';
import PreordersScreen from './components/PreordersScreen';
import FintracScreen from './components/FintracScreen';
import HundredWaysScreen from './components/HundredWaysScreen';
import InventoryScreen from './components/InventoryScreen';
import SerphintScreen from './components/SerphintScreen';
import SettingsScreen from './components/SettingsScreen';
import StoreSettingsPanel from './components/StoreSettingsPanel';
import TransferScreen from './components/TransferScreen';
import TrendsScreen from './components/TrendsScreen';
import TriageScreen, { clearTriageCache } from './components/TriageScreen';
import LoginScreen from './components/LoginScreen';

if (Platform.OS === 'web' && typeof document !== 'undefined') {
  const styleId = 'cgold-tx-row-hover';
  let style = document.getElementById(styleId);
  if (!style) {
    style = document.createElement('style');
    style.id = styleId;
    document.head.appendChild(style);
  }
  style.textContent = [
    'html,body,#root{height:100%;max-height:100dvh;overflow:hidden;}',
    'html,body,input,textarea,button,select{font-family:Sohne,sans-serif;}',
    '.cgold-tx-row{cursor:pointer;transition:none!important;background-color:transparent;}',
    '.cgold-tx-row:hover{background-color:#e8e8ed!important;}',
    '.cgold-tx-row:active{background-color:#e5e5ea!important;}',
    '.cgold-tx-row-selected,.cgold-tx-row-selected:hover{background-color:#e8e8ed!important;}',
    '.cgold-filter-option{cursor:pointer;transition:none!important;}',
    '.cgold-filter-option:hover{background-color:#f5f5f5!important;}',
    '.cgold-floating-tip{position:fixed;z-index:100000;pointer-events:none;max-width:280px;min-width:160px;padding:8px 10px;border-radius:6px;background:#1a1a1a;box-shadow:0 4px 16px rgba(0,0,0,0.18);font:12px/16px Sohne,sans-serif;color:#fff;white-space:pre-wrap;}',
    '.cgold-sidebar-item .cgold-sidebar-unpin{opacity:0;transition:opacity 120ms;}',
    '.cgold-sidebar-item:hover .cgold-sidebar-unpin,.cgold-sidebar-item:focus-within .cgold-sidebar-unpin{opacity:1;}',
    '.cgold-apps-toolbar-blur{-webkit-backdrop-filter:saturate(180%) blur(16px);backdrop-filter:saturate(180%) blur(16px);}',
  ].join('');
}

const TX_ROW_HEIGHT = 44;

const fontFamily = 'Sohne';
const titleFontFamily = 'SohneLeicht';

const FILTER_COLUMNS = [
  { key: 'storeName', label: 'Store', colStyle: 'colStore' },
  { key: 'dateLabel', label: 'Date', colStyle: 'colDate' },
  { key: 'timeLabel', label: 'Time', colStyle: 'colTime' },
  { key: 'reference', label: 'PO# / SO#', colStyle: 'colRef' },
  { key: 'customerName', label: 'Customer', colStyle: 'colCustomer' },
  { key: 'paymentMethodLabel', label: 'Payment Method', colStyle: 'colPayment' },
  { key: 'amountLabel', label: 'Amount', colStyle: 'colAmount' },
  { key: 'employeeName', label: 'Employee', colStyle: 'colEmployee' },
];

function buildColumnOptions(rows) {
  const options = {};
  for (const col of FILTER_COLUMNS) {
    const seen = new Set();
    for (let i = 0; i < rows.length; i += 1) {
      seen.add(rows[i][col.key] || '—');
    }
    options[col.key] = Array.from(seen).sort((a, b) =>
      String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' }),
    );
  }
  return options;
}

function ColumnFilterMenu({
  field,
  label,
  options,
  filter,
  onChange,
  onClose,
  fintracOnly,
  onToggleFintrac,
  fintracCount,
}) {
  const [search, setSearch] = useState('');
  const allValues = options;
  const selectedCount = filter == null ? allValues.length : Object.keys(filter).length;
  const allSelected = filter == null;
  const noneSelected = filter != null && selectedCount === 0;
  const isAmount = field === 'amountLabel';

  const visibleOptions = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allValues;
    return allValues.filter((value) => String(value).toLowerCase().includes(q));
  }, [allValues, search]);

  const isChecked = (value) => (filter == null ? true : Boolean(filter[value]));

  const selectAll = () => onChange(null);

  const clearAll = () => onChange({});

  const toggleValue = (value) => {
    const nextSelected = new Set(filter == null ? allValues : Object.keys(filter));
    if (nextSelected.has(value)) nextSelected.delete(value);
    else nextSelected.add(value);

    if (nextSelected.size === allValues.length) {
      onChange(null);
      return;
    }

    const next = {};
    nextSelected.forEach((item) => {
      next[item] = true;
    });
    onChange(next);
  };

  const renderOption = ({ item }) => {
    const checked = isChecked(item);
    return (
      <Pressable
        style={styles.filterOption}
        onPress={() => toggleValue(item)}
        {...(Platform.OS === 'web' ? { className: 'cgold-filter-option' } : null)}
      >
        <Ionicons
          name={checked ? 'checkbox' : 'square-outline'}
          size={20}
          color={checked ? '#1d1d1f' : '#c7c7cc'}
        />
        <Text style={styles.filterOptionText} numberOfLines={1}>
          {item}
        </Text>
      </Pressable>
    );
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.filterModalRoot}>
        <Pressable style={styles.filterModalBackdrop} onPress={onClose} />
        <View style={styles.filterMenu}>
          <View style={styles.filterMenuHeader}>
            <Text style={styles.filterMenuTitle}>{label}</Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <Ionicons name="close" size={20} color="#8e8e93" />
            </Pressable>
          </View>

          {isAmount ? (
            <Pressable style={styles.filterPreset} onPress={onToggleFintrac}>
              <Ionicons
                name={fintracOnly ? 'checkbox' : 'square-outline'}
                size={20}
                color={fintracOnly ? '#8a1c1c' : '#c7c7cc'}
              />
              <View style={styles.filterPresetTextWrap}>
                <Text style={styles.filterPresetTitle}>
                  Cash ≥ {formatAmount(FINTRAC_CASH_THRESHOLD)}
                </Text>
                <Text style={styles.filterPresetSub}>
                  FINTRAC pre-report{typeof fintracCount === 'number' ? ` · ${fintracCount}` : ''}
                </Text>
              </View>
            </Pressable>
          ) : null}

          <View style={styles.filterField}>
            <Text style={styles.filterFieldLabel}>Search</Text>
            <TextInput
              style={styles.filterFieldInput}
              value={search}
              onChangeText={setSearch}
              placeholder="Filter values"
              placeholderTextColor="#999"
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus={Platform.OS === 'web'}
            />
            {search ? (
              <Pressable onPress={() => setSearch('')} hitSlop={8}>
                <Ionicons name="close-circle" size={13} color="#b0b0b0" />
              </Pressable>
            ) : null}
          </View>

          <View style={styles.filterActions}>
            <Pressable onPress={selectAll} disabled={allSelected}>
              <Text style={[styles.filterActionText, allSelected && styles.filterActionDisabled]}>
                Select all
              </Text>
            </Pressable>
            <Text style={styles.filterActionSep}>·</Text>
            <Pressable onPress={clearAll} disabled={noneSelected}>
              <Text style={[styles.filterActionText, noneSelected && styles.filterActionDisabled]}>
                Clear
              </Text>
            </Pressable>
            <Text style={styles.filterCount}>
              {selectedCount}/{allValues.length}
            </Text>
          </View>

          <View style={styles.filterList}>
            <FlashList
              data={visibleOptions}
              keyExtractor={(item) => String(item)}
              renderItem={renderOption}
              extraData={filter}
              drawDistance={200}
              ListEmptyComponent={
                <Text style={styles.filterEmpty}>No matching values</Text>
              }
            />
          </View>

          <Pressable style={styles.filterDoneButton} onPress={onClose}>
            <Text style={styles.filterDoneButtonText}>Done</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function FilterableHeaderCell({ label, colStyle, active, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ hovered, pressed }) => [
        styles.txTableHeaderCell,
        colStyle,
        (hovered || pressed) && styles.txTableHeaderCellHover,
      ]}
    >
      <Text
        style={[styles.txTableHeaderLabel, active && styles.txTableHeaderLabelActive]}
        numberOfLines={1}
      >
        {label}
      </Text>
      <Ionicons
        name={active ? 'funnel' : 'chevron-down'}
        size={11}
        color={active ? '#1d1d1f' : '#c7c7cc'}
      />
    </Pressable>
  );
}

function TxTableHeader({
  hideStore = false,
  columnFilters,
  fintracCashOnly,
  onOpenFilter,
  interactive = true,
}) {
  const columns = hideStore
    ? FILTER_COLUMNS.filter((col) => col.key !== 'storeName')
    : FILTER_COLUMNS;

  return (
    <View style={styles.txTableHeader}>
      {columns.map((col) => {
        const active =
          columnFilters?.[col.key] != null ||
          (col.key === 'amountLabel' && fintracCashOnly);
        if (!interactive) {
          return (
            <Text
              key={col.key}
              style={[styles.txTableHeaderLabel, styles[col.colStyle]]}
              numberOfLines={1}
            >
              {col.label}
            </Text>
          );
        }
        return (
          <FilterableHeaderCell
            key={col.key}
            label={col.label}
            colStyle={styles[col.colStyle]}
            active={active}
            onPress={() => onOpenFilter(col.key)}
          />
        );
      })}
    </View>
  );
}

const APP_COLUMNS = 6;
const APP_COLUMNS_MOBILE = 4;
const APP_GAP = 24;
const APP_ICON_SIZE = 76;
const APP_ICON_SIZE_MOBILE = 62;
const APP_GRID_MAX_WIDTH = 880;
const MOBILE_BREAKPOINT = 768;

function useIsMobile() {
  const { width } = useWindowDimensions();
  return width < MOBILE_BREAKPOINT;
}

function useAppGridLayout() {
  const { width } = useWindowDimensions();
  if (width < MOBILE_BREAKPOINT) {
    return { columns: APP_COLUMNS_MOBILE, iconSize: APP_ICON_SIZE_MOBILE, maxWidth: undefined, gap: 16, rowGap: 20 };
  }
  if (width < 1240) {
    return { columns: 5, iconSize: 70, maxWidth: 740, gap: 22, rowGap: 24 };
  }
  return { columns: APP_COLUMNS, iconSize: APP_ICON_SIZE, maxWidth: APP_GRID_MAX_WIDTH, gap: APP_GAP, rowGap: 28 };
}

function filledIonicon(name) {
  return typeof name === 'string' && name.endsWith('-outline') ? name.slice(0, -8) : name;
}

const MAIN_TABS = [
  { key: 'home', label: 'Home', icon: 'home-outline' },
  { key: 'tools', label: 'Apps', icon: 'apps-outline' },
];

const PROFILE_TAB = { key: 'profile', label: 'Profile', icon: 'person-outline' };

const TOOL_CARDS = [
  { key: 'transactions', label: 'Transactions', icon: 'swap-horizontal-outline', tint: '#E8F1FF', accent: '#2F6FED' },
  { key: 'inventory', label: 'Inventory', icon: 'cube-outline', tint: '#FFF4E5', accent: '#C47A12' },
  { key: 'preorders', label: 'Preorders', icon: 'cart-outline', tint: '#FFF7ED', accent: '#EA580C' },
  { key: 'ai', label: 'AI', icon: 'sparkles-outline', tint: '#F3EEFF', accent: '#6B4DE6' },
  { key: 'audit', label: 'Audit', icon: 'clipboard-outline', tint: '#EEF8F1', accent: '#2F8A4E' },
  { key: 'transfer', label: 'Transfer', icon: 'arrow-forward-outline', tint: '#EEF7FB', accent: '#1F7A9A' },
  { key: 'fintrac', label: 'FINTRAC', icon: 'document-text-outline', tint: '#F7F0EA', accent: '#8A5A3A' },
  { key: 'financials', label: 'Financials', icon: 'wallet-outline', tint: '#F0F8EE', accent: '#3D8B4F' },
  { key: 'accounting', label: 'Accounting', icon: 'calculator-outline', tint: '#EEF2FF', accent: '#3730A3' },
  { key: 'trends', label: 'Trends', icon: 'trending-up-outline', tint: '#F4F0FF', accent: '#5A4FC7' },
  { key: 'bonuses', label: 'Bonuses', icon: 'gift-outline', tint: '#FEF9C3', accent: '#A16207' },
  { key: 'leaderboards', label: 'Leaderboards', icon: 'trophy-outline', tint: '#FFF8E8', accent: '#B8860B' },
  { key: 'tasks', label: 'Tasks', icon: 'checkbox-outline', tint: '#EEF6FF', accent: '#2B6CB0' },
  { key: 'police-report', label: 'Police Report', icon: 'shield-outline', tint: '#F4F4F5', accent: '#3F3F46' },
  { key: 'security', label: 'Security', icon: 'lock-closed-outline', tint: '#EEF2FF', accent: '#374151' },
  { key: 'serphint', label: 'Serphint', icon: 'eye-outline', tint: '#ECFDF5', accent: '#047857' },
  { key: 'supplies', label: 'Supplies', icon: 'bag-handle-outline', tint: '#FFF1F2', accent: '#BE123C' },
  { key: 'employees', label: 'Employees', icon: 'people-outline', tint: '#EFF6FF', accent: '#1D4ED8' },
  { key: 'customers', label: 'Customers', icon: 'person-circle-outline', tint: '#F0FDFA', accent: '#0F766E' },
  { key: 'calendar', label: 'Calendar', icon: 'calendar-outline', tint: '#FEF3C7', accent: '#B45309' },
  { key: 'notifications', label: 'Notifications', icon: 'notifications-outline', tint: '#FEE2E2', accent: '#B91C1C' },
  { key: 'reviews', label: 'Reviews', icon: 'star-outline', tint: '#FEF9C3', accent: '#A16207' },
  { key: 'emails', label: 'Emails', icon: 'mail-outline', tint: '#E0E7FF', accent: '#4338CA' },
  { key: 'documents', label: 'Documents', icon: 'folder-outline', tint: '#E2E8F0', accent: '#475569' },
  { key: 'contacts', label: 'Contacts', icon: 'book-outline', tint: '#FCE7F3', accent: '#BE185D' },
  { key: 'triage', label: 'Triage', icon: 'medkit-outline', tint: '#FFEDD5', accent: '#C2410C' },
  { key: '100-ways', label: '100 Ways', icon: 'list-outline', tint: '#E0F2FE', accent: '#0369A1' },
  { key: 'cdn-coin', label: 'Cdn Coin', icon: 'logo-bitcoin', tint: '#FEF3C7', accent: '#D97706' },
  { key: 'pmx', label: 'PMX', icon: 'diamond-outline', tint: '#F5F3FF', accent: '#6D28D9' },
  { key: 'shipping', label: 'Shipping', icon: 'airplane-outline', tint: '#ECFEFF', accent: '#0E7490' },
  { key: 'storage', label: 'Storage', icon: 'archive-outline', tint: '#F1F5F9', accent: '#334155' },
  { key: 'settings', label: 'Settings', icon: 'settings-outline', tint: '#F4F4F5', accent: '#52525B' },
];

const TOOL_KEYS = new Set(TOOL_CARDS.map((tool) => tool.key));

const STORE_DRAWER_TAB_KEYS = [
  'transactions',
  'inventory',
  'financials',
  'audit',
  'supplies',
  'leaderboards',
  'serphint',
  'ai',
  'triage',
  'settings',
];

const STORE_DRAWER_TABS = STORE_DRAWER_TAB_KEYS.map((key) =>
  TOOL_CARDS.find((tool) => tool.key === key),
).filter(Boolean);

const TRANSACTION_DETAIL_TAB_KEYS = ['triage', 'ai', 'serphint'];

const TRANSACTION_DETAIL_TABS = TRANSACTION_DETAIL_TAB_KEYS.map((key) =>
  TOOL_CARDS.find((tool) => tool.key === key),
).filter(Boolean);

const STORE_DRAWER_RAIL_WIDTH = 68;

function displayName(session) {
  if (!session) return '';
  if (session.profile?.fullName) return session.profile.fullName;
  const user = session.user;
  if (!user) return '';

  const fromParts = [user.first_name, user.last_name]
    .filter(Boolean)
    .join(' ')
    .trim();

  return fromParts || user.name || user.full_name || '';
}

function initialsFromName(name) {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return '';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function emptyHomeStoreRow(store) {
  return {
    store,
    saleCount: 0,
    purchaseCount: 0,
    soAmount: 0,
    poAmount: 0,
    txCount: 0,
    totalAmount: 0,
    transactions: [],
  };
}

function ProfileAvatar({ uri, name, size = 24, style }) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [uri]);

  const initials = initialsFromName(name);
  const showImage = Boolean(uri) && !failed;

  return (
    <View
      style={[
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#e8e8ed',
          overflow: 'hidden',
        },
        style,
      ]}
    >
      {showImage ? (
        <Image
          source={{ uri }}
          style={{ width: size, height: size }}
          onError={() => setFailed(true)}
        />
      ) : initials ? (
        <Text
          style={{
            fontFamily,
            fontSize: Math.max(10, Math.round(size * 0.38)),
            fontWeight: '600',
            color: '#1d1d1f',
          }}
        >
          {initials}
        </Text>
      ) : (
        <Ionicons name="person" size={Math.round(size * 0.5)} color="#8e8e93" />
      )}
    </View>
  );
}

function ToolCard({ tool, pinned, onPress, onTogglePin, wrapStyle, iconSize = APP_ICON_SIZE }) {
  const scale = useRef(new Animated.Value(1)).current;
  const hovered = useRef(false);
  const [isHovered, setIsHovered] = useState(false);
  const radius = Math.round(iconSize * 0.223);
  const glyphSize = Math.round(iconSize * 0.44);

  const animateTo = (nextScale, duration = 160) => {
    Animated.timing(scale, {
      toValue: nextScale,
      duration,
      useNativeDriver: true,
    }).start();
  };

  const handleHoverIn = () => {
    hovered.current = true;
    setIsHovered(true);
    animateTo(1.04, 140);
  };

  const handleHoverOut = () => {
    hovered.current = false;
    setIsHovered(false);
    animateTo(1, 140);
  };

  const handlePressIn = () => {
    animateTo(0.9, 80);
  };

  const handlePressOut = () => {
    animateTo(hovered.current ? 1.04 : 1, 120);
  };

  return (
    <Animated.View
      style={[
        styles.toolCardWrap,
        wrapStyle,
        { transform: [{ scale }] },
      ]}
      onMouseEnter={handleHoverIn}
      onMouseLeave={handleHoverOut}
    >
      <View style={styles.toolCard}>
        <View style={styles.toolIconStack}>
          <Pressable
            onPress={onPress}
            onPressIn={handlePressIn}
            onPressOut={handlePressOut}
            accessibilityRole="button"
            accessibilityLabel={tool.label}
          >
            <View
              style={[
                styles.toolIconTile,
                {
                  width: iconSize,
                  height: iconSize,
                  borderRadius: radius,
                  backgroundColor: tool.accent,
                },
              ]}
            >
              <Ionicons name={filledIonicon(tool.icon)} size={glyphSize} color="#fff" />
            </View>
          </Pressable>
          <Pressable
            style={[
              styles.pinButton,
              (isHovered || pinned) && styles.pinButtonVisible,
              pinned && styles.pinButtonActive,
            ]}
            onPress={onTogglePin}
            pointerEvents={isHovered || pinned ? 'auto' : 'none'}
            hitSlop={8}
            accessibilityLabel={pinned ? `Unpin ${tool.label}` : `Pin ${tool.label}`}
          >
            <Ionicons
              name={pinned ? 'pin' : 'pin-outline'}
              size={11}
              color={pinned ? '#1a1a1a' : '#6b6b6b'}
            />
          </Pressable>
        </View>
        <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={tool.label}>
          <Text style={styles.toolCardLabel} numberOfLines={2} selectable={false}>
            {tool.label}
          </Text>
        </Pressable>
      </View>
    </Animated.View>
  );
}

function ToolsGrid({
  tools,
  pinnedKeys,
  onOpen,
  onTogglePin,
  columns = APP_COLUMNS,
  iconSize = APP_ICON_SIZE,
  gap = APP_GAP,
  rowGap = 22,
}) {
  const itemStyle = {
    width: `${100 / columns}%`,
    maxWidth: `${100 / columns}%`,
    paddingHorizontal: gap / 2,
  };

  return (
    <View style={[styles.toolsGrid, { marginHorizontal: -(gap / 2), rowGap }]}>
      {tools.map((tool) => (
        <ToolCard
          key={tool.key}
          tool={tool}
          pinned={pinnedKeys.includes(tool.key)}
          onPress={() => onOpen(tool)}
          onTogglePin={() => onTogglePin(tool.key)}
          wrapStyle={itemStyle}
          iconSize={iconSize}
        />
      ))}
    </View>
  );
}

function ToolListRow({ tool, pinned, onPress, onTogglePin, last }) {
  const [isHovered, setIsHovered] = useState(false);
  const iconSize = 40;
  const radius = Math.round(iconSize * 0.223);

  return (
    <View
      style={[
        styles.toolListRow,
        isHovered && styles.toolListRowHovered,
        last && styles.toolListRowLast,
      ]}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <Pressable
        style={styles.toolListMain}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={tool.label}
      >
        <View
          style={[
            styles.toolListIcon,
            {
              width: iconSize,
              height: iconSize,
              borderRadius: radius,
              backgroundColor: tool.accent,
            },
          ]}
        >
          <Ionicons name={filledIonicon(tool.icon)} size={20} color="#fff" />
        </View>
        <Text style={styles.toolListLabel} numberOfLines={1} selectable={false}>
          {tool.label}
        </Text>
      </Pressable>
      <Pressable
        style={styles.toolListPin}
        onPress={onTogglePin}
        hitSlop={8}
        accessibilityLabel={pinned ? `Unpin ${tool.label}` : `Pin ${tool.label}`}
      >
        <Ionicons
          name={pinned ? 'pin' : 'pin-outline'}
          size={16}
          color={pinned ? '#1a1a1a' : '#c7c7cc'}
        />
      </Pressable>
    </View>
  );
}

function ToolsList({ tools, pinnedKeys, onOpen, onTogglePin }) {
  return (
    <View style={styles.toolsList}>
      {tools.map((tool, index) => (
        <ToolListRow
          key={tool.key}
          tool={tool}
          pinned={pinnedKeys.includes(tool.key)}
          onPress={() => onOpen(tool)}
          onTogglePin={() => onTogglePin(tool.key)}
          last={index === tools.length - 1}
        />
      ))}
    </View>
  );
}

function DatePickerField({ label, value, onChange, minimumDate, maximumDate, plain = false }) {
  const [open, setOpen] = useState(false);
  const dateValue = parseDateParam(value);
  const chipStyle = plain ? styles.homeDateField : styles.dateChip;
  const iconColor = plain ? '#8e8e93' : '#6b6b6b';
  const valueSize = plain ? 16 : 13;

  const commit = (next) => {
    if (!next) return;
    let date = parseDateParam(next);
    if (minimumDate && date < parseDateParam(minimumDate)) {
      date = parseDateParam(minimumDate);
    }
    if (maximumDate && date > parseDateParam(maximumDate)) {
      date = parseDateParam(maximumDate);
    }
    onChange(date);
  };

  if (Platform.OS === 'web') {
    return (
      <View style={chipStyle}>
        {plain ? null : <Text style={styles.dateChipLabel}>{label}</Text>}
        <View style={styles.dateChipControl}>
          <Ionicons name="calendar-outline" size={plain ? 16 : 14} color={iconColor} />
          {createElement('input', {
            type: 'date',
            value: formatDateParam(dateValue),
            min: minimumDate ? formatDateParam(minimumDate) : undefined,
            max: maximumDate ? formatDateParam(maximumDate) : undefined,
            onChange: (event) => {
              if (event.target.value) commit(event.target.value);
            },
            style: {
              border: 'none',
              background: 'transparent',
              fontFamily,
              fontSize: valueSize,
              color: '#1d1d1f',
              padding: 0,
              margin: 0,
              outline: 'none',
              cursor: 'pointer',
              minWidth: plain ? 108 : 118,
            },
          })}
        </View>
      </View>
    );
  }

  return (
    <>
      <Pressable style={chipStyle} onPress={() => setOpen(true)}>
        {plain ? null : <Text style={styles.dateChipLabel}>{label}</Text>}
        <View style={styles.dateChipControl}>
          <Ionicons name="calendar-outline" size={plain ? 16 : 14} color={iconColor} />
          <Text style={[styles.dateChipValue, plain && styles.homeDateFieldValue]}>
            {formatPickerDate(dateValue)}
          </Text>
        </View>
      </Pressable>

      {Platform.OS === 'android' && open ? (
        <DateTimePicker
          value={dateValue}
          mode="date"
          display="default"
          minimumDate={minimumDate ? parseDateParam(minimumDate) : undefined}
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
                <Text style={styles.dateModalTitle}>{label}</Text>
                <Pressable onPress={() => setOpen(false)} hitSlop={8}>
                  <Text style={styles.dateModalDone}>Done</Text>
                </Pressable>
              </View>
              <DateTimePicker
                value={dateValue}
                mode="date"
                display="spinner"
                minimumDate={minimumDate ? parseDateParam(minimumDate) : undefined}
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

const TransactionListRow = memo(function TransactionListRow({
  item,
  selected,
  onPress,
  employeeCount,
  onAmountHover,
  hideStore = false,
}) {
  const [amountTip, setAmountTip] = useState('');
  const [amountAnchor, setAmountAnchor] = useState(null);
  const [employeeAnchor, setEmployeeAnchor] = useState(null);
  const fintrac = isFintracCash(item);
  const isBuy = item.type === 'purchase';

  const handleAmountEnter = async (event) => {
    setAmountAnchor(event?.currentTarget || null);
    if (item.paymentBreakdownLabel) {
      setAmountTip(item.paymentBreakdownLabel);
    } else if (!amountTip) {
      setAmountTip('…');
    }
    if (!item.paymentBreakdown && onAmountHover) {
      const label = await onAmountHover(item);
      if (label) setAmountTip(label);
      else if (!item.paymentBreakdownLabel) setAmountTip(item.amountLabel || '');
    }
  };

  return (
    <Pressable
      onPress={() => onPress(item)}
      style={({ hovered, pressed }) => [
        styles.txTableRow,
        (hovered || pressed) && styles.toolListRowHovered,
        selected && styles.txListRowSelected,
      ]}
      accessibilityRole="button"
      accessibilityLabel={`${isBuy ? 'PO' : 'SO'} ${item.customerName || ''} ${item.amountLabel || ''}`}
      {...(Platform.OS === 'web'
        ? { className: selected ? 'cgold-tx-row cgold-tx-row-selected' : 'cgold-tx-row' }
        : null)}
    >
      {hideStore ? null : (
        <Text style={[styles.txTableCell, styles.colStore]} numberOfLines={1}>
          {item.storeName || '—'}
        </Text>
      )}
      <Text style={[styles.txTableCell, styles.txTableCellSecondary, styles.colDate]} numberOfLines={1}>
        {item.dateLabel}
      </Text>
      <Text style={[styles.txTableCell, styles.txTableCellSecondary, styles.colTime]} numberOfLines={1}>
        {item.timeLabel}
      </Text>
      <View style={[styles.txTableRef, styles.colRef]}>
        <Text style={[styles.txTableKind, isBuy && styles.txTableKindBuy]}>
          {isBuy ? 'PO' : 'SO'}
        </Text>
        <Text style={[styles.txTableCell, styles.txTableCellSecondary]} numberOfLines={1}>
          {item.reference}
        </Text>
      </View>
      <Text style={[styles.txTableCell, styles.txTableCellPrimary, styles.colCustomer]} numberOfLines={1}>
        {item.customerName || '—'}
      </Text>
      <Text style={[styles.txTableCell, styles.colPayment]} numberOfLines={1}>
        {item.paymentMethodLabel || '—'}
      </Text>
      <View
        style={[styles.txTableAmount, styles.colAmount]}
        {...(Platform.OS === 'web'
          ? {
              onMouseEnter: handleAmountEnter,
              onMouseLeave: () => setAmountAnchor(null),
            }
          : null)}
      >
        {fintrac ? <View style={styles.fintracDot} /> : null}
        <Text
          style={[styles.txTableAmountText, fintrac && styles.amountCellFintrac]}
          numberOfLines={1}
        >
          {item.amountLabel}
        </Text>
        <FloatingTooltip
          visible={Boolean(amountAnchor && amountTip)}
          text={amountTip}
          anchorEl={amountAnchor}
          align="end"
        />
      </View>
      <View
        style={styles.colEmployee}
        {...(Platform.OS === 'web'
          ? {
              onMouseEnter: (event) => setEmployeeAnchor(event?.currentTarget || null),
              onMouseLeave: () => setEmployeeAnchor(null),
            }
          : null)}
      >
        <Text style={[styles.txTableCell, styles.txTableCellSecondary]} numberOfLines={1}>
          {item.employeeName || '—'}
        </Text>
        <FloatingTooltip
          visible={Boolean(employeeAnchor)}
          text={`${employeeCount} transaction${employeeCount === 1 ? '' : 's'} in this period`}
          anchorEl={employeeAnchor}
          align="end"
        />
      </View>
    </Pressable>
  );
});

function FloatingTooltip({ visible, text, anchorEl, align = 'start', placement = 'bottom' }) {
  const [coords, setCoords] = useState(null);

  const updatePosition = useCallback(() => {
    if (!visible || Platform.OS !== 'web' || !anchorEl?.getBoundingClientRect) {
      setCoords(null);
      return;
    }
    const rect = anchorEl.getBoundingClientRect();
    setCoords({
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
    });
  }, [anchorEl, visible]);

  useLayoutEffect(() => {
    updatePosition();
  }, [updatePosition, text]);

  useEffect(() => {
    if (!visible || Platform.OS !== 'web') return undefined;
    const onMove = () => updatePosition();
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [visible, updatePosition]);

  if (Platform.OS !== 'web' || !visible || !text || !coords || typeof document === 'undefined') {
    return null;
  }

  const style =
    placement === 'left'
      ? {
          top: coords.y + coords.height / 2,
          right: Math.max(8, window.innerWidth - coords.x + 8),
          transform: 'translateY(-50%)',
          minWidth: 'auto',
          whiteSpace: 'nowrap',
        }
      : {
          top: coords.y + coords.height + 4,
          ...(align === 'end'
            ? { right: Math.max(8, window.innerWidth - (coords.x + coords.width)) }
            : { left: Math.max(8, coords.x) }),
        };

  return createPortal(
    createElement('div', { className: 'cgold-floating-tip', style }, text),
    document.body,
  );
}

function StoreDrawerAppButton({ tab, selected, onPress }) {
  const iconSize = 36;
  const radius = Math.round(iconSize * 0.223);

  return (
    <View style={styles.storeDrawerTabWrap}>
      {Platform.OS === 'web'
        ? createElement(
            'div',
            {
              className: 'cgold-floating-tip',
              style: {
                position: 'absolute',
                right: 56,
                top: '50%',
                transform: 'translateY(-50%)',
                minWidth: 'auto',
                whiteSpace: 'nowrap',
              },
            },
            tab.label,
          )
        : (
          <View style={styles.storeDrawerTabTip} pointerEvents="none">
            <View style={styles.storeDrawerTabTipBubble}>
              <Text style={styles.storeDrawerTabTipText} numberOfLines={1}>
                {tab.label}
              </Text>
            </View>
          </View>
        )}
      <Pressable
        onPress={onPress}
        style={({ hovered, pressed }) => [
          styles.storeDrawerTab,
          (hovered || pressed) && !selected && styles.tabHover,
          selected && styles.storeDrawerTabSelected,
        ]}
        accessibilityLabel={tab.label}
        accessibilityRole="button"
        accessibilityState={{ selected }}
      >
        <View
          style={[
            styles.toolIconTile,
            {
              width: iconSize,
              height: iconSize,
              borderRadius: radius,
              backgroundColor: tab.accent,
            },
          ]}
        >
          <Ionicons name={filledIonicon(tab.icon)} size={18} color="#fff" />
        </View>
      </Pressable>
    </View>
  );
}

function AppleDetailRow({ label, value, sub, last, dense }) {
  return (
    <View
      style={[
        styles.appleDetailRow,
        dense && styles.txDetailRow,
        last && styles.toolListRowLast,
      ]}
    >
      <Text style={[styles.appleDetailLabel, dense && styles.txDetailLabel]}>{label}</Text>
      <View style={styles.appleDetailValueWrap}>
        <Text style={[styles.appleDetailValue, dense && styles.txDetailValue]} numberOfLines={2}>
          {value || '—'}
        </Text>
        {sub ? (
          <Text style={[styles.appleDetailSub, dense && styles.txDetailSub]} numberOfLines={2}>
            {sub}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function lineItemName(item) {
  const product = item?.product;
  const candidates = [
    item?.description,
    product?.name,
    product?.description,
    item?.quality_mark_description,
    product?.sku,
    product?.code,
  ]
    .map((value) => (value == null ? '' : String(value).trim()))
    .filter(Boolean);

  if (candidates.length) {
    const primary = candidates[0];
    const quality = item?.quality_mark_description
      ? String(item.quality_mark_description).trim()
      : '';
    if (
      quality &&
      !primary.toLowerCase().includes(quality.toLowerCase()) &&
      quality.toLowerCase() !== primary.toLowerCase()
    ) {
      return `${primary} · ${quality}`;
    }
    return primary;
  }

  if (product?.metal?.name) {
    return product?.type === 'scrap'
      ? `Scrap ${product.metal.name}`
      : product.metal.name;
  }

  return 'Untitled item';
}

function lineItemMeta(item) {
  const product = item?.product;
  const bits = [];
  const name = lineItemName(item).toLowerCase();

  if (product?.sku && !name.includes(String(product.sku).toLowerCase())) {
    bits.push(product.sku);
  } else if (
    product?.code &&
    !name.includes(String(product.code).toLowerCase()) &&
    product.code !== product?.sku
  ) {
    bits.push(product.code);
  }

  if (item?.purity != null && item.purity !== '') {
    bits.push(`${item.purity}%`);
  }

  if (item?.unit_type) {
    const qty = item.quantity ?? item.gross_quantity;
    if (qty != null) bits.push(`${qty} ${item.unit_type}`);
  }

  return bits.join(' · ');
}

function toQtyNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function formatLineQty(value) {
  const n = toQtyNumber(value);
  if (n == null) return '—';
  if (Object.is(n, -0)) return '0';
  if (Number.isInteger(n)) return String(n);
  return String(Math.round(n * 1000) / 1000);
}

function collectImageUrls(images) {
  const urls = [];
  const seen = new Set();
  for (const image of Array.isArray(images) ? images : []) {
    const url = String(image?.url || image?.thumbnail || image || '').trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    urls.push(url);
  }
  return urls;
}

function lineItemImages(item) {
  const fromItem = collectImageUrls(item?.images);
  if (fromItem.length) return fromItem;
  return collectImageUrls(item?.product?.images);
}

function lineItemOrderedQty(item) {
  return toQtyNumber(item?.quantity ?? item?.gross_quantity) ?? 0;
}

function lineItemDeliveredQty(item) {
  const fulfilled = toQtyNumber(item?.fulfilled_quantity ?? item?.gross_fulfilled_quantity);
  if (fulfilled != null) return fulfilled;
  const deliveries = Array.isArray(item?.deliveries) ? item.deliveries : [];
  return deliveries.reduce(
    (sum, entry) => sum + (toQtyNumber(entry?.quantity ?? entry?.gross_quantity) || 0),
    0,
  );
}

function lineDeliveryState(item) {
  const ordered = lineItemOrderedQty(item);
  const delivered = lineItemDeliveredQty(item);
  if (delivered <= 0.0005) {
    return { key: 'undelivered', label: 'Undelivered', ordered, delivered };
  }
  if (ordered > 0 && delivered + 0.0005 < ordered) {
    return { key: 'partial', label: 'Partial', ordered, delivered };
  }
  return { key: 'delivered', label: 'Delivered', ordered, delivered };
}

function allocationState(detail) {
  if (!detail) return null;
  const raw = String(detail.allocation_status || '').trim();
  const allocated = toQtyNumber(detail.allocated_amount);
  const total = toQtyNumber(detail.total_amount);
  if (/partial/i.test(raw)) {
    return { key: 'partial', label: 'Partially allocated', raw, allocated, total };
  }
  if (/not paid|unallocated|unpaid|to be received/i.test(raw)) {
    return { key: 'unallocated', label: 'Unallocated', raw, allocated, total };
  }
  if (/paid|allocated|overpaid/i.test(raw)) {
    return { key: 'allocated', label: 'Allocated', raw, allocated, total };
  }
  if (allocated != null && total != null) {
    if (allocated <= 0.005) {
      return { key: 'unallocated', label: 'Unallocated', raw, allocated, total };
    }
    if (allocated + 0.005 < total) {
      return { key: 'partial', label: 'Partially allocated', raw, allocated, total };
    }
    return { key: 'allocated', label: 'Allocated', raw, allocated, total };
  }
  return raw ? { key: 'unknown', label: raw, raw, allocated, total } : null;
}

function documentDeliveryState(detail, items) {
  const lines = items.map(lineDeliveryState);
  const deliveredLines = lines.filter((line) => line.key === 'delivered').length;
  const partialLines = lines.filter((line) => line.key === 'partial').length;
  const ordered = lines.reduce((sum, line) => sum + line.ordered, 0);
  const delivered = lines.reduce((sum, line) => sum + line.delivered, 0);
  const itemStatus = String(detail?.item_status || '').trim();

  let key = 'undelivered';
  let label = 'Undelivered';
  if (lines.length && deliveredLines === lines.length) {
    key = 'delivered';
    label = 'Delivered';
  } else if (delivered > 0.0005 || partialLines > 0) {
    key = 'partial';
    label = 'Partially delivered';
  } else if (/sent|received|delivered|complete|fulfilled/i.test(itemStatus)) {
    key = 'delivered';
    label = 'Delivered';
  }

  return {
    key,
    label,
    ordered,
    delivered,
    deliveredLines,
    lineCount: lines.length,
    itemStatus,
  };
}

function statusTone(key) {
  if (key === 'allocated' || key === 'delivered') return 'ok';
  if (key === 'partial') return 'warn';
  if (key === 'unallocated' || key === 'undelivered') return 'muted';
  return 'neutral';
}

function TxStatusChip({ label, tone = 'neutral' }) {
  return (
    <View
      style={[
        styles.txStatusChip,
        tone === 'ok' && styles.txStatusChipOk,
        tone === 'warn' && styles.txStatusChipWarn,
        tone === 'muted' && styles.txStatusChipMuted,
      ]}
    >
      <Text
        style={[
          styles.txStatusChipText,
          tone === 'ok' && styles.txStatusChipTextOk,
          tone === 'warn' && styles.txStatusChipTextWarn,
          tone === 'muted' && styles.txStatusChipTextMuted,
        ]}
      >
        {label}
      </Text>
    </View>
  );
}

function LineItemThumb({ urls, name }) {
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
    setIndex(0);
  }, [urls[0]]);

  if (!urls.length || failed) {
    return <View style={styles.txLineThumbSlot} />;
  }

  const current = urls[Math.min(index, urls.length - 1)];
  const hasMany = urls.length > 1;

  return (
    <>
      <Pressable
        onPress={() => {
          setIndex(0);
          setOpen(true);
        }}
        style={styles.txLineThumbPress}
        accessibilityRole="button"
        accessibilityLabel={`View photo of ${name}`}
      >
        <Image
          source={{ uri: urls[0] }}
          style={styles.txLineThumb}
          resizeMode="cover"
          onError={() => setFailed(true)}
        />
        {hasMany ? (
          <View style={styles.txLineThumbBadge}>
            <Text style={styles.txLineThumbBadgeText}>{urls.length}</Text>
          </View>
        ) : null}
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View style={styles.txImageViewerRoot}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setOpen(false)} />
          <View style={styles.txImageViewerSheet} pointerEvents="box-none">
            <View style={styles.txImageViewerBar}>
              <Text style={styles.txImageViewerTitle} numberOfLines={1}>
                {name}
                {hasMany ? `  ${index + 1}/${urls.length}` : ''}
              </Text>
              <Pressable
                onPress={() => setOpen(false)}
                hitSlop={8}
                style={styles.appleCloseButton}
                accessibilityLabel="Close photo"
              >
                <Ionicons name="close" size={18} color="#1d1d1f" />
              </Pressable>
            </View>
            <Image
              source={{ uri: current }}
              style={styles.txImageViewerImage}
              resizeMode="contain"
            />
            {hasMany ? (
              <View style={styles.txImageViewerNav}>
                <Pressable
                  onPress={() => setIndex((currentIndex) => (currentIndex - 1 + urls.length) % urls.length)}
                  style={styles.txImageViewerNavBtn}
                  accessibilityLabel="Previous photo"
                >
                  <Ionicons name="chevron-back" size={20} color="#fff" />
                </Pressable>
                <Pressable
                  onPress={() => setIndex((currentIndex) => (currentIndex + 1) % urls.length)}
                  style={styles.txImageViewerNavBtn}
                  accessibilityLabel="Next photo"
                >
                  <Ionicons name="chevron-forward" size={20} color="#fff" />
                </Pressable>
              </View>
            ) : null}
          </View>
        </View>
      </Modal>
    </>
  );
}

const DRAWER_OPEN_MS = 280;
const DRAWER_CLOSE_MS = 220;

function useRightDrawerAnimation(visible, slideDistance) {
  const [mounted, setMounted] = useState(visible);
  const slide = useRef(new Animated.Value(slideDistance)).current;
  const backdrop = useRef(new Animated.Value(0)).current;
  const slideDistanceRef = useRef(slideDistance);
  const activeAnim = useRef(null);
  slideDistanceRef.current = slideDistance;

  const stopActiveAnim = () => {
    if (activeAnim.current) {
      activeAnim.current.stop();
      activeAnim.current = null;
    }
  };

  useEffect(() => {
    if (!mounted) {
      slide.setValue(slideDistance);
    }
  }, [slideDistance, mounted, slide]);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      return undefined;
    }

    if (!mounted) return undefined;

    stopActiveAnim();
    const anim = Animated.parallel([
      Animated.timing(slide, {
        toValue: slideDistanceRef.current,
        duration: DRAWER_CLOSE_MS,
        easing: Easing.bezier(0.4, 0, 0.2, 1),
        useNativeDriver: true,
      }),
      Animated.timing(backdrop, {
        toValue: 0,
        duration: DRAWER_CLOSE_MS,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    ]);
    activeAnim.current = anim;

    anim.start(({ finished }) => {
      if (activeAnim.current === anim) activeAnim.current = null;
      if (finished) setMounted(false);
    });

    return () => {
      if (activeAnim.current === anim) {
        anim.stop();
        activeAnim.current = null;
      }
    };
  }, [visible, mounted, slide, backdrop]);

  useLayoutEffect(() => {
    if (!visible || !mounted) return undefined;

    stopActiveAnim();
    slide.setValue(slideDistanceRef.current);
    backdrop.setValue(0);

    let cancelled = false;
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        if (cancelled) return;
        const anim = Animated.parallel([
          Animated.timing(slide, {
            toValue: 0,
            duration: DRAWER_OPEN_MS,
            easing: Easing.bezier(0.2, 0.8, 0.2, 1),
            useNativeDriver: true,
          }),
          Animated.timing(backdrop, {
            toValue: 1,
            duration: DRAWER_OPEN_MS,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
        ]);
        activeAnim.current = anim;
        anim.start(({ finished }) => {
          if (finished && activeAnim.current === anim) activeAnim.current = null;
        });
      });
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [visible, mounted, slide, backdrop]);

  return { mounted, slide, backdrop };
}

function useHeldValue(value) {
  const held = useRef(value);
  if (value != null) held.current = value;
  return value ?? held.current;
}

function TransactionDetailDrawer({ visible, summary, detail, loading, error, onClose }) {
  const { width: windowWidth } = useWindowDimensions();
  const isMobile = windowWidth < MOBILE_BREAKPOINT;
  const [activeApp, setActiveApp] = useState(null);
  const { hasApp } = useAppAccess();
  const visibleTabs = TRANSACTION_DETAIL_TABS.filter((tab) => hasApp(tab.key));
  const showRail = visibleTabs.length > 0;
  const railWidth = showRail ? STORE_DRAWER_RAIL_WIDTH : 0;
  const panelWidth = isMobile
    ? Math.max(windowWidth - railWidth, 240)
    : Math.min(
        Math.max(Math.round(windowWidth * 0.82), 640),
        Math.round(windowWidth - 56),
      );
  const slideDistance = panelWidth + railWidth;
  const { mounted, slide, backdrop } = useRightDrawerAnimation(visible, slideDistance);
  const heldSummary = useHeldValue(summary);
  const heldDetail = useHeldValue(detail);

  useEffect(() => {
    if (visible) {
      setActiveApp(null);
    }
  }, [visible]);

  if (!mounted || !heldSummary) return null;

  const client = heldDetail?.client;
  const clientName = client
    ? [client.first_name, client.last_name].filter(Boolean).join(' ').trim()
    : heldSummary.customerName;
  const location = heldDetail?.location;
  const locationName = location?.name || heldSummary.storeName;
  const locationLine = location
    ? [location.address_1, location.city, location.state, location.zip].filter(Boolean).join(', ')
    : null;
  const items = Array.isArray(heldDetail?.items) ? heldDetail.items : [];
  const payments = Array.isArray(heldDetail?.payments) ? heldDetail.payments : [];
  const totalAmount = heldDetail?.total_amount ?? heldSummary.amount;
  const isPurchase = heldSummary.type === 'purchase';
  const docLabel = isPurchase ? 'Purchase order' : 'Sales invoice';
  const docKind = isPurchase ? 'PO' : 'SO';
  const partyLabel = isPurchase ? 'Vendor / customer' : 'Bill to';
  const allocation = heldDetail ? allocationState(heldDetail) : null;
  const delivery = heldDetail ? documentDeliveryState(heldDetail, items) : null;
  const paymentStatus = String(heldDetail?.payment_status || '').trim();
  const activeTool = visibleTabs.find((tab) => tab.key === activeApp);

  return (
    <Modal visible={mounted} transparent animationType="none" onRequestClose={onClose}>
      <View style={styles.drawerRoot}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose}>
          <Animated.View style={[styles.drawerBackdrop, { opacity: backdrop }]} />
        </Pressable>

        <Animated.View
          style={[
            styles.storeDrawerShell,
            { transform: [{ translateX: slide }] },
          ]}
        >
          {showRail ? (
            <View style={styles.storeDrawerAppsRail}>
              {visibleTabs.map((tab) => (
                <StoreDrawerAppButton
                  key={tab.key}
                  tab={tab}
                  selected={tab.key === activeApp}
                  onPress={() =>
                    setActiveApp((current) => (current === tab.key ? null : tab.key))
                  }
                />
              ))}
            </View>
          ) : null}

          <View style={[styles.drawerPanel, styles.appleSheetPanel, { width: panelWidth }]}>
            <View
              style={[
                styles.invoiceTopBar,
                styles.txSheetTopBar,
                isMobile && styles.invoiceTopBarMobile,
              ]}
            >
              <Text style={styles.appleSheetTitle} numberOfLines={1}>
                {activeTool ? activeTool.label : docLabel}
              </Text>
              <Pressable
                onPress={onClose}
                hitSlop={8}
                style={styles.appleCloseButton}
                accessibilityLabel="Close"
              >
                <Ionicons name="close" size={18} color="#1d1d1f" />
              </Pressable>
            </View>

            <ScrollView
              style={styles.drawerBody}
              contentContainerStyle={[
                styles.drawerBodyContent,
                styles.txSheetBodyContent,
                isMobile && styles.drawerBodyContentMobile,
              ]}
              showsVerticalScrollIndicator={false}
            >
              {activeTool ? (
                <View style={styles.storeDrawerPlaceholder}>
                  <View
                    style={[
                      styles.toolIconTile,
                      styles.storeDrawerPlaceholderIcon,
                      { backgroundColor: activeTool.accent },
                    ]}
                  >
                    <Ionicons name={filledIonicon(activeTool.icon)} size={28} color="#fff" />
                  </View>
                  <Text style={styles.storeDrawerPlaceholderTitle}>{activeTool.label}</Text>
                  <Text style={styles.storeDrawerPlaceholderBody}>
                    {activeTool.label} for {heldSummary.reference} is coming soon.
                  </Text>
                </View>
              ) : (
                <>
                  <View style={styles.txSheetHero}>
                    <View style={styles.txSheetHeroRow}>
                      <View style={styles.txSheetHeroLeft}>
                        <Text style={styles.txSheetCustomer} numberOfLines={1}>
                          {clientName || '—'}
                        </Text>
                        <Text style={styles.txSheetMeta} numberOfLines={1}>
                          {heldSummary.reference}
                          {heldSummary.dateLabel
                            ? ` · ${heldSummary.dateLabel} ${heldSummary.timeLabel || ''}`.trim()
                            : ''}
                        </Text>
                      </View>
                      <Text style={styles.txSheetAmount}>{formatAmount(totalAmount)}</Text>
                    </View>
                    <View style={styles.txStatusRow}>
                      <TxStatusChip label={`${docKind} on file`} tone="neutral" />
                      {allocation ? (
                        <TxStatusChip
                          label={allocation.label}
                          tone={statusTone(allocation.key)}
                        />
                      ) : null}
                      {delivery ? (
                        <TxStatusChip
                          label={delivery.label}
                          tone={statusTone(delivery.key)}
                        />
                      ) : null}
                      {paymentStatus ? (
                        <TxStatusChip label={paymentStatus} tone="neutral" />
                      ) : null}
                    </View>
                  </View>

                  <View style={styles.txMetaGrid}>
                    <View style={[styles.appleGroup, styles.txMetaCol]}>
                      <AppleDetailRow
                        dense
                        label="Document"
                        value={`${docLabel} ${heldSummary.reference}`}
                        sub="On file whether allocated or delivered"
                      />
                      <AppleDetailRow
                        dense
                        label="Allocation"
                        value={
                          allocation
                            ? allocation.allocated != null && allocation.total != null
                              ? `${allocation.label} · ${formatAmount(allocation.allocated)} of ${formatAmount(allocation.total)}`
                              : allocation.label
                            : '—'
                        }
                        sub={
                          allocation?.raw && allocation.raw !== allocation.label
                            ? allocation.raw
                            : null
                        }
                      />
                      {delivery ? (
                        <AppleDetailRow
                          dense
                          label="Delivery"
                          value={
                            delivery.lineCount
                              ? `${delivery.label} · ${formatLineQty(delivery.delivered)} of ${formatLineQty(delivery.ordered)}`
                              : delivery.label
                          }
                          sub={
                            delivery.lineCount
                              ? `${delivery.deliveredLines} of ${delivery.lineCount} line${delivery.lineCount === 1 ? '' : 's'} fully delivered`
                              : null
                          }
                          last
                        />
                      ) : (
                        <AppleDetailRow dense label="Delivery" value="—" last />
                      )}
                    </View>
                    <View style={[styles.appleGroup, styles.txMetaCol]}>
                      <AppleDetailRow dense label={partyLabel} value={clientName} />
                      {client?.email ? (
                        <AppleDetailRow dense label="Email" value={client.email} />
                      ) : null}
                      {client?.phone || client?.alternate_phone ? (
                        <AppleDetailRow
                          dense
                          label="Phone"
                          value={client?.phone || client?.alternate_phone}
                        />
                      ) : null}
                      <AppleDetailRow dense label="Store" value={locationName} sub={locationLine} />
                      <AppleDetailRow
                        dense
                        label="Employee"
                        value={heldSummary.employeeName}
                        last
                      />
                    </View>
                  </View>

                  {loading ? (
                    <View style={styles.drawerLoading}>
                      <ActivityIndicator color="#1d1d1f" />
                    </View>
                  ) : null}

                  {error ? <Text style={styles.errorText}>{error}</Text> : null}

                  {!loading ? (
                    <View style={styles.txSheetSection}>
                      <Text style={styles.txSheetSectionLabel}>Line items</Text>
                      <View style={styles.appleGroup}>
                        <View style={styles.txTableHeader}>
                          <View style={styles.txLineThumbSlot} />
                          <Text style={[styles.txLineItem, styles.txTableHeaderText]}>
                            Item
                          </Text>
                          <Text style={[styles.txColQty, styles.txTableHeaderText]}>Qty</Text>
                          <Text style={[styles.txColDelivered, styles.txTableHeaderText]}>
                            Delivered
                          </Text>
                          <Text style={[styles.txColAmount, styles.txTableHeaderText]}>
                            Amount
                          </Text>
                        </View>

                        {items.length === 0 ? (
                          <Text style={styles.homeTxEmpty}>No line items</Text>
                        ) : (
                          items.map((item, index) => {
                            const name = lineItemName(item);
                            const meta = lineItemMeta(item);
                            const images = lineItemImages(item);
                            const lineDelivery = lineDeliveryState(item);
                            return (
                              <View
                                key={item.id || `${name}-${index}`}
                                style={[
                                  styles.txLineRow,
                                  index === items.length - 1 &&
                                    !heldDetail?.total_charges &&
                                    styles.toolListRowLast,
                                ]}
                              >
                                <LineItemThumb urls={images} name={name} />
                                <View style={styles.txLineItem}>
                                  <Text style={styles.txLineName} numberOfLines={2}>
                                    {name}
                                  </Text>
                                  {meta ? (
                                    <Text style={styles.txLineMeta} numberOfLines={1}>
                                      {meta}
                                    </Text>
                                  ) : null}
                                </View>
                                <Text style={[styles.txColQty, styles.txLineCell]}>
                                  {formatLineQty(lineDelivery.ordered)}
                                </Text>
                                <View style={styles.txColDelivered}>
                                  <Text
                                    style={[
                                      styles.txLineCell,
                                      styles.txLineDeliveredQty,
                                      lineDelivery.key === 'delivered' && styles.txLineOk,
                                      lineDelivery.key === 'partial' && styles.txLineWarn,
                                      lineDelivery.key === 'undelivered' && styles.txLineMuted,
                                    ]}
                                  >
                                    {formatLineQty(lineDelivery.delivered)} of{' '}
                                    {formatLineQty(lineDelivery.ordered)}
                                  </Text>
                                  <Text
                                    style={[
                                      styles.txLineDeliveredLabel,
                                      lineDelivery.key === 'delivered' && styles.txLineOk,
                                      lineDelivery.key === 'partial' && styles.txLineWarn,
                                      lineDelivery.key === 'undelivered' && styles.txLineMuted,
                                    ]}
                                  >
                                    {lineDelivery.label}
                                  </Text>
                                </View>
                                <Text style={[styles.txColAmount, styles.txLineCell]}>
                                  {formatAmount(item.price)}
                                </Text>
                              </View>
                            );
                          })
                        )}

                        {heldDetail?.total_charges ? (
                          <View style={styles.txLineRow}>
                            <View style={styles.txLineThumbSlot} />
                            <Text style={styles.txLineMutedFlex}>Charges</Text>
                            <Text style={[styles.txColAmount, styles.txLineMuted]}>
                              {formatAmount(heldDetail.total_charges)}
                            </Text>
                          </View>
                        ) : null}
                        <View style={[styles.txLineRow, styles.toolListRowLast]}>
                          <View style={styles.txLineThumbSlot} />
                          <Text style={styles.txLineTotalLabel}>Total</Text>
                          <Text style={[styles.txColAmount, styles.txLineTotalValue]}>
                            {formatAmount(totalAmount)}
                          </Text>
                        </View>
                      </View>
                    </View>
                  ) : null}

                  {!loading && payments.length > 0 ? (
                    <View style={styles.txSheetSection}>
                      <Text style={styles.txSheetSectionLabel}>Payments</Text>
                      <View style={styles.appleGroup}>
                        {payments.map((entry, index) => {
                          const payment = entry.payment || entry;
                          const method =
                            payment.payment_type?.name ||
                            entry.payment?.payment_type?.name ||
                            'Payment';
                          const payAlloc = String(
                            payment.allocation_status || entry.allocation_status || '',
                          ).trim();
                          return (
                            <View
                              key={entry.id || payment.id || `${method}-${index}`}
                              style={[
                                styles.txPaymentRow,
                                index === payments.length - 1 && styles.toolListRowLast,
                              ]}
                            >
                              <View style={styles.invoiceColItem}>
                                <Text style={styles.txLineName}>{method}</Text>
                                <Text style={styles.txLineMeta}>
                                  {[payment.status, payAlloc, payment.date]
                                    .filter(Boolean)
                                    .join(' · ')}
                                </Text>
                              </View>
                              <Text style={[styles.txColAmount, styles.txLineCell]}>
                                {formatAmount(entry.amount ?? payment.amount)}
                              </Text>
                            </View>
                          );
                        })}
                      </View>
                    </View>
                  ) : null}

                  {heldDetail?.comments ? (
                    <View style={styles.txSheetSection}>
                      <Text style={styles.txSheetSectionLabel}>Notes</Text>
                      <View style={styles.appleGroup}>
                        <Text style={styles.txNotes}>{heldDetail.comments}</Text>
                      </View>
                    </View>
                  ) : null}
                </>
              )}
            </ScrollView>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

function HomeStoreDrawer({ visible, store, session, periodLabel = 'Today', onClose }) {
  const { width: windowWidth } = useWindowDimensions();
  const isMobile = windowWidth < MOBILE_BREAKPOINT;
  const { hasApp } = useAppAccess();
  const drawerTabs = STORE_DRAWER_TABS.filter((tab) => tab.key === 'settings' || hasApp(tab.key));
  const storeName = store?.store || '';
  const overviewTab = {
    key: 'overview',
    label: storeName || 'Overview',
    icon: 'storefront',
    accent: storeAccent(storeName),
    tint: storeAccent(storeName),
    solid: true,
  };
  const railTabs = [overviewTab, ...drawerTabs];
  const maxPanelWidth = Math.max(280, windowWidth - STORE_DRAWER_RAIL_WIDTH - (isMobile ? 0 : 24));
  const panelWidth = isMobile
    ? maxPanelWidth
    : Math.min(
        Math.max(Math.round(windowWidth * 0.72), Math.min(560, maxPanelWidth)),
        maxPanelWidth,
      );
  const slideDistance = panelWidth + STORE_DRAWER_RAIL_WIDTH;
  const { mounted, slide, backdrop } = useRightDrawerAnimation(visible, slideDistance);
  const heldStore = useHeldValue(store);
  const [activeTab, setActiveTab] = useState('overview');
  const [txRows, setTxRows] = useState([]);
  const [selectedRow, setSelectedRow] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const detailRequestId = useRef(0);
  const paymentCache = useRef({});

  useEffect(() => {
    const next = store?.transactions || [];
    setTxRows(next);
    paymentCache.current = {};
    setSelectedRow((current) => {
      if (!current) return null;
      return next.find((row) => row.id === current.id) || null;
    });
  }, [store]);

  useEffect(() => {
    if (visible) {
      setActiveTab('overview');
      return;
    }

    if (!mounted) {
      setSelectedRow(null);
      setDetail(null);
      setDetailError('');
      setDetailLoading(false);
    }
  }, [visible, mounted, store?.store]);

  const employeeCounts = useMemo(() => {
    const counts = {};
    for (const row of txRows) {
      const key = row.employeeName || '—';
      counts[key] = (counts[key] || 0) + 1;
    }
    return counts;
  }, [txRows]);

  const closeDetail = useCallback(() => {
    setSelectedRow(null);
    setDetail(null);
    setDetailError('');
    setDetailLoading(false);
  }, []);

  const ensurePaymentBreakdown = useCallback(
    async (row) => {
      if (!session?.token || !row) return row?.paymentBreakdownLabel || '';
      if (paymentCache.current[row.id]?.paymentBreakdownLabel) {
        return paymentCache.current[row.id].paymentBreakdownLabel;
      }
      if (row.paymentBreakdownLabel && row.paymentBreakdown) {
        return row.paymentBreakdownLabel;
      }

      try {
        const detailPayload = await fetchTransactionDetail(session.token, {
          type: row.type,
          sourceId: row.sourceId,
        });
        const enriched = withPaymentBreakdown(row, detailPayload);
        paymentCache.current[row.id] = enriched;
        setTxRows((current) =>
          current.map((entry) => (entry.id === row.id ? enriched : entry)),
        );
        return enriched.paymentBreakdownLabel;
      } catch {
        return row.paymentBreakdownLabel || '';
      }
    },
    [session?.token],
  );

  const openDetail = useCallback(
    async (row) => {
      setSelectedRow(row);
      setDetail(null);
      setDetailError('');
      setDetailLoading(true);

      const id = ++detailRequestId.current;

      try {
        const next = await fetchTransactionDetail(session.token, {
          type: row.type,
          sourceId: row.sourceId,
        });
        if (id !== detailRequestId.current) return;
        setDetail(next);
        const enriched = withPaymentBreakdown(row, next);
        paymentCache.current[row.id] = enriched;
        setTxRows((current) =>
          current.map((entry) => (entry.id === row.id ? enriched : entry)),
        );
        setSelectedRow(enriched);
      } catch (err) {
        if (id !== detailRequestId.current) return;
        setDetailError(err?.message || 'Failed to load transaction details.');
      } finally {
        if (id === detailRequestId.current) setDetailLoading(false);
      }
    },
    [session?.token],
  );

  if (!mounted || !heldStore) return null;

  const activeTool =
    activeTab === 'overview'
      ? overviewTab
      : drawerTabs.find((tab) => tab.key === activeTab) || drawerTabs[0];

  return (
    <>
      <Modal visible={mounted} transparent animationType="none" onRequestClose={onClose}>
        <View style={styles.drawerRoot}>
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose}>
            <Animated.View style={[styles.drawerBackdrop, { opacity: backdrop }]} />
          </Pressable>

          <Animated.View
            style={[
              styles.storeDrawerShell,
              { transform: [{ translateX: slide }] },
            ]}
          >
            <View style={styles.storeDrawerAppsRail}>
              {railTabs.map((tab, index) => (
                <Fragment key={tab.key}>
                  {index === 1 || (tab.key === 'settings' && index > 1) ? (
                    <View style={styles.storeDrawerRailSep} />
                  ) : null}
                  <StoreDrawerAppButton
                    tab={tab}
                    selected={tab.key === activeTab}
                    onPress={() => setActiveTab(tab.key)}
                  />
                </Fragment>
              ))}
            </View>

            <View
              style={[
                styles.drawerPanel,
                styles.storeDrawerPanel,
                { width: panelWidth, maxWidth: panelWidth },
              ]}
            >
              <View style={[styles.invoiceTopBar, isMobile && styles.invoiceTopBarMobile]}>
                <Text style={styles.appleSheetTitle} numberOfLines={1}>
                  {activeTab === 'overview'
                    ? 'Overview'
                    : activeTab === 'settings'
                      ? 'Store settings'
                      : heldStore.store}
                </Text>
                <Pressable
                  onPress={onClose}
                  hitSlop={8}
                  style={styles.appleCloseButton}
                  accessibilityLabel="Close"
                >
                  <Ionicons name="close" size={18} color="#1d1d1f" />
                </Pressable>
              </View>

              {activeTab === 'inventory' ||
              activeTab === 'financials' ||
              activeTab === 'audit' ||
              activeTab === 'ai' ||
              activeTab === 'triage' ||
              activeTab === 'settings' ? (
                <View style={[styles.drawerBody, styles.drawerBodyFill]}>
                  <View
                    style={[
                      styles.drawerBodyContentInventory,
                      isMobile && styles.drawerBodyContentInventoryMobile,
                    ]}
                  >
                    {activeTab === 'inventory' ? (
                      <InventoryScreen
                        session={session}
                        storeFilter={heldStore.store}
                        embedded
                      />
                    ) : activeTab === 'financials' ? (
                      <FinancialsScreen
                        session={session}
                        storeFilter={heldStore.store}
                        embedded
                      />
                    ) : activeTab === 'audit' ? (
                      <AuditScreen
                        session={session}
                        storeFilter={heldStore.store}
                        embedded
                      />
                    ) : activeTab === 'ai' ? (
                      <AiScreen
                        session={session}
                        storeFilter={heldStore.store}
                        embedded
                      />
                    ) : activeTab === 'triage' ? (
                      <TriageScreen
                        session={session}
                        storeFilter={heldStore.store}
                        embedded
                      />
                    ) : (
                      <StoreSettingsPanel
                        session={session}
                        storeName={heldStore.store}
                        embedded
                      />
                    )}
                  </View>
                </View>
              ) : (
              <ScrollView
                style={styles.drawerBody}
                contentContainerStyle={[
                  styles.drawerBodyContent,
                  isMobile && styles.drawerBodyContentMobile,
                ]}
                showsVerticalScrollIndicator={false}
              >
                {activeTab === 'overview' ? (
                  <StoreOverviewPanel
                    store={heldStore}
                    periodLabel={periodLabel}
                  />
                ) : activeTab === 'transactions' ? (
                  <>
                    <View style={[styles.invoiceHeaderRow, isMobile && styles.invoiceHeaderRowMobile]}>
                      <View style={styles.invoiceHeaderLeft}>
                        <Text style={styles.invoiceNumber}>Transactions</Text>
                        <Text style={styles.emailDrawerSubtitle}>
                          {periodLabel} · {heldStore.txCount} transaction
                          {heldStore.txCount === 1 ? '' : 's'}
                        </Text>
                      </View>
                      <View style={styles.invoiceHeaderRight}>
                        <Text style={styles.invoiceTotalLabelTop}>Total</Text>
                        <Text style={styles.invoiceTotalHero}>
                          {formatAmount(heldStore.totalAmount)}
                        </Text>
                      </View>
                    </View>

                    <View style={[styles.invoiceInfoGrid, isMobile && styles.invoiceInfoGridMobile]}>
                      <View style={styles.invoiceInfoCard}>
                        <Text style={styles.invoiceSectionLabel}>Sales</Text>
                        <Text style={styles.invoicePartyName}>{heldStore.saleCount}</Text>
                        <Text style={styles.invoicePartyDetail}>
                          {formatAmount(heldStore.soAmount)} SO
                        </Text>
                      </View>
                      <View style={styles.invoiceInfoCard}>
                        <Text style={styles.invoiceSectionLabel}>Purchases</Text>
                        <Text style={styles.invoicePartyName}>{heldStore.purchaseCount}</Text>
                        <Text style={styles.invoicePartyDetail}>
                          {formatAmount(heldStore.poAmount)} PO
                        </Text>
                      </View>
                    </View>

                    <View style={styles.invoiceSection}>
                      <Text style={styles.invoiceSectionLabel}>Transactions</Text>
                      <View style={[styles.txListWrap, styles.txDrawerTable]}>
                        {txRows.length === 0 ? (
                          <Text style={styles.homeTxEmpty}>No transactions in this period.</Text>
                        ) : (
                          <>
                            <TxTableHeader hideStore interactive={false} />
                            {txRows.map((item) => (
                              <TransactionListRow
                                key={item.id}
                                item={item}
                                selected={selectedRow?.id === item.id}
                                onPress={openDetail}
                                employeeCount={employeeCounts[item.employeeName] || 0}
                                onAmountHover={ensurePaymentBreakdown}
                                hideStore
                              />
                            ))}
                          </>
                        )}
                      </View>
                    </View>
                  </>
                ) : activeTool ? (
                  <View style={styles.storeDrawerPlaceholder}>
                    <View
                      style={[
                        styles.storeDrawerPlaceholderIcon,
                        { backgroundColor: activeTool.tint },
                      ]}
                    >
                      <Ionicons name={activeTool.icon} size={28} color={activeTool.accent} />
                    </View>
                    <Text style={styles.storeDrawerPlaceholderTitle}>{activeTool.label}</Text>
                    <Text style={styles.storeDrawerPlaceholderBody}>
                      {activeTool.label} for {heldStore.store} is coming soon.
                    </Text>
                  </View>
                ) : (
                  <View style={styles.storeDrawerPlaceholder}>
                    <Text style={styles.storeDrawerPlaceholderBody}>
                      No apps are available for this store.
                    </Text>
                  </View>
                )}
              </ScrollView>
              )}
            </View>
          </Animated.View>
        </View>
      </Modal>

      <TransactionDetailDrawer
        visible={Boolean(selectedRow)}
        summary={selectedRow}
        detail={detail}
        loading={detailLoading}
        error={detailError}
        onClose={closeDetail}
      />
    </>
  );
}

const STORE_ACCENTS = {
  Hamilton: '#2F6FED',
  Mississauga: '#C47A12',
  Toronto: '#2F8A4E',
  'Richmond Hill': '#6B4DE6',
};

const STORE_ACCENT_FALLBACKS = [
  '#1D4ED8',
  '#0F766E',
  '#B91C1C',
  '#B45309',
  '#6D28D9',
  '#047857',
  '#4338CA',
  '#BE185D',
];

function storeAccent(name) {
  if (STORE_ACCENTS[name]) return STORE_ACCENTS[name];
  const value = String(name || '');
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return STORE_ACCENT_FALLBACKS[hash % STORE_ACCENT_FALLBACKS.length];
}

function StoreCountMoneyRows({ store }) {
  return (
    <>
      <View style={styles.storeOverviewStatRow}>
        <Text style={[styles.toolListLabel, styles.storeOverviewStatPrimary]}>Tx</Text>
        <Text style={[styles.homeListMeta, styles.storeOverviewStatPrimary]}>{store.txCount}</Text>
        <Text style={[styles.homeListAmount, styles.storeOverviewStatPrimary]}>
          {formatAmount(store.totalAmount)}
        </Text>
      </View>
      <View style={styles.storeOverviewStatRow}>
        <Text style={styles.toolListLabel}>SO</Text>
        <Text style={styles.homeListMeta}>{store.saleCount}</Text>
        <Text style={styles.homeListAmount}>{formatAmount(store.soAmount)}</Text>
      </View>
      <View style={[styles.storeOverviewStatRow, styles.toolListRowLast]}>
        <Text style={styles.toolListLabel}>PO</Text>
        <Text style={styles.homeListMeta}>{store.purchaseCount}</Text>
        <Text style={styles.homeListAmount}>{formatAmount(store.poAmount)}</Text>
      </View>
    </>
  );
}

function StoreOverviewPanel({ store, periodLabel }) {
  const accent = storeAccent(store.store);
  const iconSize = 72;
  const radius = Math.round(iconSize * 0.223);

  return (
    <View>
      <View style={styles.storeOverviewHero}>
        <View
          style={[
            styles.toolIconTile,
            {
              width: iconSize,
              height: iconSize,
              borderRadius: radius,
              backgroundColor: accent,
            },
          ]}
        >
          <Ionicons name="storefront" size={32} color="#fff" />
        </View>
        <Text style={styles.storeOverviewName}>{store.store}</Text>
        <Text style={styles.storeOverviewPeriod}>{periodLabel}</Text>
      </View>

      <View style={styles.toolsList}>
        <StoreCountMoneyRows store={store} />
      </View>
    </View>
  );
}

function HomeStoreTableRow({ row, selected, last, onOpenStore }) {
  const accent = storeAccent(row.store);

  return (
    <Pressable
      onPress={() => onOpenStore(row)}
      style={[
        styles.homeStoreRow,
        last && styles.homeStoreRowLast,
        selected && styles.homeStoreRowSelected,
      ]}
      {...(Platform.OS === 'web'
        ? {
            className: selected
              ? 'cgold-tx-row cgold-tx-row-selected'
              : 'cgold-tx-row',
          }
        : null)}
      accessibilityRole="button"
      accessibilityLabel={row.store}
    >
      <View style={[styles.homeStoreAccent, { backgroundColor: accent }]} />
      <Text style={[styles.homeStoreName, styles.homeStoreColStore]} numberOfLines={1}>
        {row.store}
      </Text>
      <Text style={[styles.homeStoreNum, styles.homeStoreColCount]} numberOfLines={1}>
        {row.txCount}
      </Text>
      <Text style={[styles.homeStoreMoney, styles.homeStoreColMoney]} numberOfLines={1}>
        {formatAmount(row.totalAmount)}
      </Text>
      <Text style={[styles.homeStoreNum, styles.homeStoreColCount, styles.homeStoreSecondary]} numberOfLines={1}>
        {row.saleCount}
      </Text>
      <Text style={[styles.homeStoreMoney, styles.homeStoreColMoney, styles.homeStoreSecondary]} numberOfLines={1}>
        {formatAmount(row.soAmount)}
      </Text>
      <Text style={[styles.homeStoreNum, styles.homeStoreColCount, styles.homeStoreSecondary]} numberOfLines={1}>
        {row.purchaseCount}
      </Text>
      <Text style={[styles.homeStoreMoney, styles.homeStoreColMoney, styles.homeStoreSecondary]} numberOfLines={1}>
        {formatAmount(row.poAmount)}
      </Text>
      <Ionicons name="chevron-forward" size={14} color="#c7c7cc" />
    </Pressable>
  );
}

function HomeStoresTable({ rows, selectedStore, totals, onOpenStore }) {
  return (
    <View style={styles.homeStoreTableCard}>
      <ScrollView
        horizontal
        nestedScrollEnabled
        showsHorizontalScrollIndicator={false}
        style={styles.homeStoreTableScroll}
        contentContainerStyle={styles.homeStoreTableScrollContent}
      >
        <View style={styles.homeStoreTable}>
          <View style={[styles.homeStoreRow, styles.homeStoreHeaderRow]}>
            <View style={styles.homeStoreAccent} />
            <Text style={[styles.homeStoreHeader, styles.homeStoreColStore]}>Store</Text>
            <Text style={[styles.homeStoreHeader, styles.homeStoreColCount]}>Tx</Text>
            <Text style={[styles.homeStoreHeader, styles.homeStoreColMoney]}>Amount</Text>
            <Text style={[styles.homeStoreHeader, styles.homeStoreColCount]}>SO</Text>
            <Text style={[styles.homeStoreHeader, styles.homeStoreColMoney]}>SO $</Text>
            <Text style={[styles.homeStoreHeader, styles.homeStoreColCount]}>PO</Text>
            <Text style={[styles.homeStoreHeader, styles.homeStoreColMoney]}>PO $</Text>
            <View style={styles.homeStoreChevronSpacer} />
          </View>
          {rows.map((row, index) => (
            <HomeStoreTableRow
              key={row.store}
              row={row}
              selected={selectedStore?.store === row.store}
              last={index === rows.length - 1 && !totals}
              onOpenStore={onOpenStore}
            />
          ))}
          {totals ? (
            <View style={[styles.homeStoreRow, styles.homeStoreTotalRow]}>
              <View style={styles.homeStoreAccent} />
              <Text style={[styles.homeStoreTotalLabel, styles.homeStoreColStore]} numberOfLines={1}>
                Total
              </Text>
              <Text style={[styles.homeStoreNum, styles.homeStoreColCount, styles.homeStoreTotalValue]} numberOfLines={1}>
                {totals.txCount}
              </Text>
              <Text style={[styles.homeStoreMoney, styles.homeStoreColMoney, styles.homeStoreTotalValue]} numberOfLines={1}>
                {formatAmount(totals.totalAmount)}
              </Text>
              <Text style={[styles.homeStoreNum, styles.homeStoreColCount, styles.homeStoreTotalValue]} numberOfLines={1}>
                {totals.saleCount}
              </Text>
              <Text style={[styles.homeStoreMoney, styles.homeStoreColMoney, styles.homeStoreTotalValue]} numberOfLines={1}>
                {formatAmount(totals.soAmount)}
              </Text>
              <Text style={[styles.homeStoreNum, styles.homeStoreColCount, styles.homeStoreTotalValue]} numberOfLines={1}>
                {totals.purchaseCount}
              </Text>
              <Text style={[styles.homeStoreMoney, styles.homeStoreColMoney, styles.homeStoreTotalValue]} numberOfLines={1}>
                {formatAmount(totals.poAmount)}
              </Text>
              <View style={styles.homeStoreChevronSpacer} />
            </View>
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}

function HomeScreen({ session, onRequireLogin }) {
  const isMobile = useIsMobile();
  const appGrid = useAppGridLayout();
  const storeRestricted = isRestrictedHomeEmployee(session?.profile);
  const assignedStore = allocatedStoreName(session?.profile);
  const initialRange = useMemo(() => defaultDateRange(7), []);
  const [dateMode, setDateMode] = useState('day');
  const [startDate, setStartDate] = useState(() => parseDateParam(new Date()));
  const [endDate, setEndDate] = useState(() => parseDateParam(new Date()));
  const [query, setQuery] = useState('');
  const [storeRows, setStoreRows] = useState([]);
  const [selectedStore, setSelectedStore] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const requestId = useRef(0);

  const todayKey = formatDateParam(parseDateParam(new Date()));
  const startKey = storeRestricted ? todayKey : formatDateParam(startDate);
  const endKey = storeRestricted ? todayKey : dateMode === 'day' ? startKey : formatDateParam(endDate);
  const isToday = dateMode === 'day' && startKey === todayKey;
  const periodLabel =
    dateMode === 'day'
      ? isToday
        ? 'Today'
        : formatPickerDate(startDate)
      : `${formatPickerDate(startDate)} – ${formatPickerDate(endDate)}`;
  const sectionWidth = { maxWidth: Math.max(appGrid.maxWidth || 0, 1100) };

  const load = useCallback(
    async ({ silent = false } = {}) => {
      if (!session?.token) {
        setStoreRows([]);
        setSelectedStore(null);
        setError('');
        return;
      }

      const id = ++requestId.current;
      if (!silent) {
        setLoading(true);
        setError('');
      }

      try {
        const result = await fetchHomeStoreSummaries(session, {
          startDate: startKey,
          endDate: endKey,
        });
        if (id !== requestId.current) return;
        setStoreRows(result.rows);
        setSelectedStore((current) => {
          if (!current) return null;
          return result.rows.find((row) => row.store === current.store) || null;
        });
        setError(result.warning || '');
      } catch (err) {
        if (id !== requestId.current) return;
        if (!silent) {
          setStoreRows([]);
          setSelectedStore(null);
          setError(err?.message || 'Failed to load store summary.');
        }
      } finally {
        if (id === requestId.current && !silent) setLoading(false);
      }
    },
    [session, startKey, endKey],
  );

  useEffect(() => {
    if (!storeRestricted) return;
    const day = parseDateParam(new Date());
    setDateMode('day');
    setStartDate(day);
    setEndDate(day);
    setQuery('');
  }, [storeRestricted]);

  useEffect(() => {
    load();

    const intervalId = setInterval(() => {
      load({ silent: true });
    }, 15 * 60 * 1000);

    return () => clearInterval(intervalId);
  }, [load]);

  const scopedRows = useMemo(() => {
    if (!storeRestricted) return storeRows;
    const matched = filterRowsToAllocatedStore(storeRows, session?.profile);
    if (matched.length > 0) return matched;
    if (assignedStore) return [emptyHomeStoreRow(assignedStore)];
    return [];
  }, [storeRestricted, storeRows, session?.profile, assignedStore]);

  const visibleRows = useMemo(() => {
    if (storeRestricted) return scopedRows;
    const q = query.trim().toLowerCase();
    if (!q) return scopedRows;
    return scopedRows.filter((row) => row.store.toLowerCase().includes(q));
  }, [scopedRows, query, storeRestricted]);

  const totals = useMemo(() => {
    return visibleRows.reduce(
      (acc, row) => {
        acc.txCount += row.txCount || 0;
        acc.totalAmount += row.totalAmount || 0;
        acc.saleCount += row.saleCount || 0;
        acc.soAmount += row.soAmount || 0;
        acc.purchaseCount += row.purchaseCount || 0;
        acc.poAmount += row.poAmount || 0;
        return acc;
      },
      {
        txCount: 0,
        totalAmount: 0,
        saleCount: 0,
        soAmount: 0,
        purchaseCount: 0,
        poAmount: 0,
      },
    );
  }, [visibleRows]);

  const selectToday = () => {
    const day = parseDateParam(new Date());
    setDateMode('day');
    setStartDate(day);
    setEndDate(day);
  };

  const selectRange = () => {
    if (storeRestricted) return;
    setDateMode('range');
    if (formatDateParam(startDate) === formatDateParam(endDate)) {
      setStartDate(initialRange.start);
      setEndDate(initialRange.end);
    }
  };

  const handleDayChange = (date) => {
    const next = parseDateParam(date);
    setStartDate(next);
    setEndDate(next);
  };

  const handleStartChange = (date) => {
    const next = parseDateParam(date);
    setStartDate(next);
    if (next > endDate) setEndDate(next);
  };

  const handleEndChange = (date) => {
    const next = parseDateParam(date);
    setEndDate(next);
    if (next < startDate) setStartDate(next);
  };

  const openStore = useCallback((row) => {
    setSelectedStore(row);
  }, []);

  const closeStore = useCallback(() => {
    setSelectedStore(null);
  }, []);

  if (!session?.token) {
    return (
      <View style={styles.toolsScreen}>
        <View style={styles.homeInnerCentered}>
          <Text style={[styles.contentTitle, styles.homeTitle]}>Home</Text>
          <Text style={styles.homeSubtitle}>Log in to see store summaries.</Text>
          <Pressable style={[styles.loginButton, styles.homeLoginButton]} onPress={onRequireLogin}>
            <Text style={styles.loginButtonText}>Log in</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.toolsScreen}>
      {storeRestricted ? null : (
        <View
          style={[
            styles.toolsToolbar,
            isMobile && styles.toolsToolbarMobile,
            sectionWidth,
          ]}
        >
          <View style={[styles.toolsSearch, isMobile && styles.toolsSearchMobile]}>
            <Ionicons name="search" size={16} color="#8e8e93" style={styles.toolsSearchIcon} />
            <TextInput
              style={styles.toolsSearchInput}
              value={query}
              onChangeText={setQuery}
              placeholder="Search"
              placeholderTextColor="#8e8e93"
              autoCapitalize="none"
              autoCorrect={false}
              clearButtonMode="while-editing"
            />
            {query ? (
              <Pressable onPress={() => setQuery('')} hitSlop={8}>
                <Ionicons name="close-circle" size={18} color="#c7c7cc" />
              </Pressable>
            ) : null}
          </View>
        </View>
      )}

      {storeRestricted ? (
        <View style={[styles.homeControls, isMobile && styles.homeControlsMobile, sectionWidth]}>
          <View style={styles.homeSegment}>
            <View style={[styles.homeSegmentButton, styles.homeSegmentButtonActive]}>
              <Text style={[styles.homeSegmentText, styles.homeSegmentTextActive]}>Today</Text>
            </View>
          </View>
        </View>
      ) : (
      <View style={[styles.homeControls, isMobile && styles.homeControlsMobile, sectionWidth]}>
        <View style={styles.homeSegment} accessibilityRole="tablist">
          <Pressable
            style={[
              styles.homeSegmentButton,
              dateMode === 'day' && isToday && styles.homeSegmentButtonActive,
            ]}
            onPress={selectToday}
            accessibilityRole="tab"
            accessibilityState={{ selected: dateMode === 'day' && isToday }}
          >
            <Text
              style={[
                styles.homeSegmentText,
                dateMode === 'day' && isToday && styles.homeSegmentTextActive,
              ]}
            >
              Today
            </Text>
          </Pressable>
          <Pressable
            style={[
              styles.homeSegmentButton,
              dateMode === 'range' && styles.homeSegmentButtonActive,
            ]}
            onPress={selectRange}
            accessibilityRole="tab"
            accessibilityState={{ selected: dateMode === 'range' }}
          >
            <Text
              style={[
                styles.homeSegmentText,
                dateMode === 'range' && styles.homeSegmentTextActive,
              ]}
            >
              Range
            </Text>
          </Pressable>
        </View>

        {dateMode === 'day' ? (
          <DatePickerField
            label="Date"
            value={startDate}
            onChange={handleDayChange}
            maximumDate={new Date()}
            plain
          />
        ) : (
          <>
            <DatePickerField
              label="From"
              value={startDate}
              onChange={handleStartChange}
              maximumDate={endDate}
              plain
            />
            <Text style={styles.homeDateSep}>–</Text>
            <DatePickerField
              label="To"
              value={endDate}
              onChange={handleEndChange}
              minimumDate={startDate}
              maximumDate={new Date()}
              plain
            />
          </>
        )}
      </View>
      )}

      <View style={[styles.homeMetaRow, sectionWidth]}>
        <Text style={styles.homeMeta} numberOfLines={1}>
          {loading && storeRows.length === 0
            ? 'Loading…'
            : `${visibleRows.length}${
                !storeRestricted && visibleRows.length !== storeRows.length
                  ? ` of ${storeRows.length}`
                  : ''
              } store${visibleRows.length === 1 ? '' : 's'} · ${totals.txCount} tx · ${formatAmount(
                totals.totalAmount,
              )} · ${periodLabel}`}
        </Text>
        {loading && storeRows.length > 0 ? (
          <ActivityIndicator size="small" color="#8e8e93" />
        ) : null}
      </View>

      {error ? <Text style={[styles.errorText, styles.homeError, sectionWidth]}>{error}</Text> : null}

      <ScrollView
        style={styles.toolsScroll}
        contentContainerStyle={styles.toolsScrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {loading && storeRows.length === 0 ? (
          <View style={styles.homeTableEmpty}>
            <ActivityIndicator color="#1d1d1f" />
          </View>
        ) : visibleRows.length === 0 ? (
          <Text style={[styles.toolsEmpty, sectionWidth]}>
            {storeRestricted && !assignedStore
              ? 'Your store is not set in Aureus.'
              : query.trim()
                ? `No stores match “${query.trim()}”.`
                : 'No store activity in this period.'}
          </Text>
        ) : (
          <View
            style={[
              styles.toolsSection,
              isMobile && styles.toolsSectionMobile,
              sectionWidth,
            ]}
          >
            <HomeStoresTable
              rows={visibleRows}
              selectedStore={selectedStore}
              totals={totals}
              onOpenStore={openStore}
            />
          </View>
        )}
      </ScrollView>

      <HomeStoreDrawer
        visible={Boolean(selectedStore)}
        store={selectedStore}
        session={session}
        periodLabel={periodLabel}
        onClose={closeStore}
      />
    </View>
  );
}

function EmailStoreDrawer({ visible, store, onClose }) {
  const { width: windowWidth } = useWindowDimensions();
  const isMobile = windowWidth < MOBILE_BREAKPOINT;
  const panelWidth = isMobile
    ? windowWidth
    : Math.max(Math.round(windowWidth * 0.5), 420);
  const { mounted, slide, backdrop } = useRightDrawerAnimation(visible, panelWidth);
  const heldStore = useHeldValue(store);

  if (!mounted || !heldStore) return null;

  return (
    <Modal visible={mounted} transparent animationType="none" onRequestClose={onClose}>
      <View style={styles.drawerRoot}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose}>
          <Animated.View style={[styles.drawerBackdrop, { opacity: backdrop }]} />
        </Pressable>

        <Animated.View
          style={[
            styles.drawerPanel,
            {
              width: panelWidth,
              transform: [{ translateX: slide }],
            },
          ]}
        >
          <View style={[styles.invoiceTopBar, isMobile && styles.invoiceTopBarMobile]}>
            <Text style={styles.invoiceDocLabel}>Email capture</Text>
            <Pressable onPress={onClose} hitSlop={8} style={styles.drawerClose}>
              <Ionicons name="close" size={18} color="#6b6b6b" />
            </Pressable>
          </View>

          <ScrollView
            style={styles.drawerBody}
            contentContainerStyle={[
              styles.drawerBodyContent,
              isMobile && styles.drawerBodyContentMobile,
            ]}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.invoiceHeaderRow}>
              <View style={styles.invoiceHeaderLeft}>
                <Text style={styles.invoiceNumber}>{heldStore.store}</Text>
                <Text style={styles.emailDrawerSubtitle}>
                  {heldStore.customerCount} named + {heldStore.walkInCount} walk-in ={' '}
                  {heldStore.totalTransactions} transactions
                </Text>
              </View>
              <View style={styles.invoiceHeaderRight}>
                <Text style={styles.invoiceTotalLabelTop}>Email rate</Text>
                <Text style={styles.invoiceTotalHero}>{heldStore.rateLabel}</Text>
                <Text style={styles.invoicePartyDetail}>
                  {heldStore.withEmail} ÷ {heldStore.customerCount} named
                </Text>
              </View>
            </View>

            <Text style={[styles.emailDrawerSubtitle, { marginBottom: 12 }]}>
              Rate = customers with a valid email ÷ named customers. Walk-ins are excluded from
              the percentage.
            </Text>

            <View style={styles.invoiceInfoGrid}>
              <View style={styles.invoiceInfoCard}>
                <Text style={styles.invoiceSectionLabel}>Named customers</Text>
                <Text style={styles.invoicePartyName}>{heldStore.customerCount}</Text>
                <Text style={styles.invoicePartyDetail}>
                  {heldStore.withEmail} with valid email · {heldStore.peopleFractionLabel} of txs
                </Text>
              </View>
              <View style={styles.invoiceInfoCard}>
                <Text style={styles.invoiceSectionLabel}>Walk-in</Text>
                <Text style={styles.invoicePartyName}>{heldStore.walkInCount}</Text>
                <Text style={styles.invoicePartyDetail}>
                  Excluded from rate · {heldStore.walkInCount} of{' '}
                  {heldStore.totalTransactions} transactions
                </Text>
              </View>
            </View>

            <View style={styles.invoiceSection}>
              <Text style={styles.invoiceSectionLabel}>Named customer breakdown</Text>
              <View style={styles.emailBreakdownHeader}>
                <Text style={[styles.emailBreakdownHeaderText, styles.emailBreakdownColPerson]}>
                  Person
                </Text>
                <Text style={[styles.emailBreakdownHeaderText, styles.emailBreakdownColEmail]}>
                  Email
                </Text>
                <Text style={[styles.emailBreakdownHeaderText, styles.emailBreakdownColEmployee]}>
                  Employee
                </Text>
              </View>

              {heldStore.people.length === 0 ? (
                <Text style={styles.invoiceEmptyLine}>No named customers in this period.</Text>
              ) : (
                heldStore.people.map((person) => (
                  <View key={person.id} style={styles.emailBreakdownRow}>
                    <Text style={styles.emailBreakdownPerson} numberOfLines={2}>
                      {person.customerName}
                    </Text>
                    <Text
                      style={[
                        styles.emailBreakdownEmail,
                        !person.hasEmail && styles.emailBreakdownEmailMissing,
                      ]}
                      numberOfLines={2}
                    >
                      {person.emailLabel}
                    </Text>
                    <Text style={styles.emailBreakdownEmployee} numberOfLines={2}>
                      {person.employeeName}
                    </Text>
                  </View>
                ))
              )}
            </View>
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

function EmailsScreen({ session, onRequireLogin, focus = null, onFocusConsumed }) {
  const initialRange = useMemo(() => defaultDateRange(7), []);
  const [dateMode, setDateMode] = useState('day'); // 'day' | 'range'
  const [startDate, setStartDate] = useState(() => parseDateParam(new Date()));
  const [endDate, setEndDate] = useState(() => parseDateParam(new Date()));
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedStore, setSelectedStore] = useState(null);
  const requestId = useRef(0);
  const pendingStoreRef = useRef(null);
  const appliedFocusKey = useRef(null);

  const todayKey = formatDateParam(parseDateParam(new Date()));
  const startKey = formatDateParam(startDate);
  const endKey = dateMode === 'day' ? startKey : formatDateParam(endDate);
  const isToday = dateMode === 'day' && startKey === todayKey;

  useEffect(() => {
    if (!focus?.key || focus.key === appliedFocusKey.current) return;
    appliedFocusKey.current = focus.key;
    const nextStart = parseDateParam(focus.startDate || new Date());
    const nextEnd = parseDateParam(focus.endDate || focus.startDate || new Date());
    pendingStoreRef.current = focus.storeName || null;
    setDateMode('range');
    setStartDate(nextStart);
    setEndDate(nextEnd);
    onFocusConsumed?.();
  }, [focus, onFocusConsumed]);

  const load = useCallback(async () => {
    if (!session?.token) {
      setRows([]);
      setError('');
      setSelectedStore(null);
      return;
    }

    const id = ++requestId.current;
    setLoading(true);
    setError('');

    try {
      const result = await fetchTransactions(session.token, {
        startDate: startKey,
        endDate: endKey,
      });
      if (id !== requestId.current) return;
      setRows(result.rows);
      if (!pendingStoreRef.current) {
        setSelectedStore(null);
      }
      setError('');
    } catch (err) {
      if (id !== requestId.current) return;
      setRows([]);
      setSelectedStore(null);
      setError(err?.message || 'Failed to load email capture.');
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [session?.token, startKey, endKey]);

  useEffect(() => {
    load();
  }, [load]);

  const storeRows = useMemo(() => buildEmailCaptureByStore(rows), [rows]);

  useEffect(() => {
    const wanted = pendingStoreRef.current;
    if (!wanted || !storeRows.length) return;
    const match = storeRows.find(
      (row) => row.store.localeCompare(wanted, undefined, { sensitivity: 'base' }) === 0,
    );
    if (match) {
      setSelectedStore(match);
      pendingStoreRef.current = null;
    }
  }, [storeRows]);

  const totals = useMemo(() => {
    const customerCount = storeRows.reduce((sum, row) => sum + row.customerCount, 0);
    const walkInCount = storeRows.reduce((sum, row) => sum + row.walkInCount, 0);
    const withEmail = storeRows.reduce((sum, row) => sum + row.withEmail, 0);
    const totalTransactions = customerCount + walkInCount;
    const rate = customerCount > 0 ? (withEmail / customerCount) * 100 : 0;
    return {
      customerCount,
      walkInCount,
      withEmail,
      totalTransactions,
      rateLabel: `${rate.toFixed(1)}%`,
      peopleFractionLabel:
        totalTransactions > 0 ? `${customerCount}/${totalTransactions}` : '0/0',
    };
  }, [storeRows]);

  const selectToday = () => {
    const day = parseDateParam(new Date());
    setDateMode('day');
    setStartDate(day);
    setEndDate(day);
  };

  const selectRange = () => {
    setDateMode('range');
    if (formatDateParam(startDate) === formatDateParam(endDate)) {
      setStartDate(initialRange.start);
      setEndDate(initialRange.end);
    }
  };

  const handleDayChange = (date) => {
    const next = parseDateParam(date);
    setStartDate(next);
    setEndDate(next);
  };

  const handleStartChange = (date) => {
    const next = parseDateParam(date);
    setStartDate(next);
    if (next > endDate) setEndDate(next);
  };

  const handleEndChange = (date) => {
    const next = parseDateParam(date);
    setEndDate(next);
    if (next < startDate) setStartDate(next);
  };

  if (!session?.token) {
    return (
      <View style={styles.transactionsBody}>
        <Text style={styles.toolPageBody}>
          Sign in from Profile to load email capture by store.
        </Text>
        <Pressable style={styles.loginButton} onPress={onRequireLogin}>
          <Text style={styles.loginButtonText}>Go to Profile</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.transactionsBody}>
      <View style={styles.transactionsToolbar}>
        <View style={styles.dateFilters}>
          <View style={styles.dateModeGroup}>
            <Pressable
              style={[styles.dateModeChip, dateMode === 'day' && isToday && styles.dateModeChipActive]}
              onPress={selectToday}
            >
              <Text
                style={[
                  styles.dateModeChipText,
                  dateMode === 'day' && isToday && styles.dateModeChipTextActive,
                ]}
              >
                Today
              </Text>
            </Pressable>
            <Pressable
              style={[styles.dateModeChip, dateMode === 'range' && styles.dateModeChipActive]}
              onPress={selectRange}
            >
              <Text
                style={[
                  styles.dateModeChipText,
                  dateMode === 'range' && styles.dateModeChipTextActive,
                ]}
              >
                Range
              </Text>
            </Pressable>
          </View>

          {dateMode === 'day' ? (
            <DatePickerField
              label="Date"
              value={startDate}
              onChange={handleDayChange}
              maximumDate={new Date()}
            />
          ) : (
            <>
              <DatePickerField
                label="From"
                value={startDate}
                onChange={handleStartChange}
                maximumDate={endDate}
              />
              <Text style={styles.dateRangeSep}>–</Text>
              <DatePickerField
                label="To"
                value={endDate}
                onChange={handleEndChange}
                minimumDate={startDate}
                maximumDate={new Date()}
              />
            </>
          )}
        </View>
      </View>

      <View style={styles.transactionsMetaRow}>
        <Text style={styles.transactionsMeta}>
          {loading && rows.length === 0
            ? 'Loading…'
            : `${storeRows.length} store${storeRows.length === 1 ? '' : 's'} · ${totals.customerCount} named + ${totals.walkInCount} walk-in = ${totals.totalTransactions} txs · ${totals.rateLabel} email rate`}
          {dateMode === 'day'
            ? isToday
              ? ' · today'
              : ` · ${formatPickerDate(startDate)}`
            : ` · ${formatPickerDate(startDate)} – ${formatPickerDate(endDate)}`}
        </Text>
      </View>

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <View style={styles.homeTableWrap}>
        <View style={styles.homeTableHeader}>
          <Text style={[styles.homeHeaderCell, styles.homeColStore]}>Store</Text>
          <Text style={[styles.homeHeaderCell, styles.emailColCustomers]}>Customers</Text>
          <Text style={[styles.homeHeaderCell, styles.emailColRate]}>Email rate</Text>
        </View>

        {loading && storeRows.length === 0 ? (
          <View style={styles.homeTableEmpty}>
            <ActivityIndicator color="#1a1a1a" />
          </View>
        ) : storeRows.length === 0 ? (
          <View style={styles.homeTableEmpty}>
            <Text style={styles.tableEmptyText}>No customers in this period.</Text>
          </View>
        ) : (
          <ScrollView
            style={styles.homeTableScroll}
            contentContainerStyle={styles.homeTableListContent}
          >
            {storeRows.map((row) => {
              const selected = selectedStore?.store === row.store;
              return (
                <Pressable
                  key={row.store}
                  onPress={() => setSelectedStore(row)}
                  style={({ hovered, pressed }) => [
                    styles.homeTableRow,
                    !selected && (hovered || pressed) && styles.tableRowHover,
                    selected && styles.tableRowSelected,
                  ]}
                  {...(Platform.OS === 'web'
                    ? {
                        className: selected
                          ? 'cgold-tx-row cgold-tx-row-selected'
                          : 'cgold-tx-row',
                      }
                    : null)}
                >
                  <Text style={styles.homeCellEmailStore} numberOfLines={1}>
                    {row.store}
                  </Text>
                <View style={styles.emailColCustomers}>
                  <Text style={styles.homeCellPrimary} numberOfLines={1}>
                    {row.customerCount}
                  </Text>
                  <Text style={styles.homeCellSecondary} numberOfLines={1}>
                    ({row.withEmail} with email · {row.walkInCount} walk-in ·{' '}
                    {row.totalTransactions} txs)
                  </Text>
                </View>
                  <Text style={styles.emailCellRate} numberOfLines={1}>
                    {row.rateLabel}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        )}
      </View>

      <EmailStoreDrawer
        visible={Boolean(selectedStore)}
        store={selectedStore}
        onClose={() => setSelectedStore(null)}
      />
    </View>
  );
}

function TransactionsScreen({ session, onRequireLogin }) {
  const isMobile = useIsMobile();
  const initialRange = useMemo(() => defaultDateRange(7), []);
  const [dateMode, setDateMode] = useState('day'); // 'day' | 'range'
  const [startDate, setStartDate] = useState(() => parseDateParam(new Date()));
  const [endDate, setEndDate] = useState(() => parseDateParam(new Date()));
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [summary, setSummary] = useState(null);
  const [columnFilters, setColumnFilters] = useState({});
  const [openFilter, setOpenFilter] = useState(null);
  const [fintracCashOnly, setFintracCashOnly] = useState(false);
  const [selectedRow, setSelectedRow] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const requestId = useRef(0);
  const detailRequestId = useRef(0);
  const paymentCache = useRef({});
  const enrichRequestId = useRef(0);

  const todayKey = formatDateParam(parseDateParam(new Date()));
  const startKey = formatDateParam(startDate);
  const endKey = dateMode === 'day' ? startKey : formatDateParam(endDate);
  const isToday = dateMode === 'day' && startKey === todayKey;

  const load = useCallback(async () => {
    if (!session?.token) {
      setRows([]);
      setSummary(null);
      setError('');
      return;
    }

    const id = ++requestId.current;
    setLoading(true);
    setError('');

    try {
      const result = await fetchTransactions(session.token, {
        startDate: startKey,
        endDate: endKey,
      });
      if (id !== requestId.current) return;
      setRows(result.rows);
      setColumnFilters({});
      setOpenFilter(null);
      setFintracCashOnly(false);
      setSelectedRow(null);
      setDetail(null);
      setDetailError('');
      paymentCache.current = {};
      setSummary({
        orderCount: result.orderCount,
        purchaseCount: result.purchaseCount,
      });
    } catch (err) {
      if (id !== requestId.current) return;
      setRows([]);
      setSummary(null);
      setError(err?.message || 'Failed to load transactions.');
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [session?.token, startKey, endKey]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!session?.token || rows.length === 0) return;

    const candidates = rows.filter(needsPaymentEnrichment);
    if (candidates.length === 0) return;

    const enrichId = ++enrichRequestId.current;
    let cancelled = false;

    (async () => {
      const queue = [...candidates];
      const workers = Array.from({ length: Math.min(4, queue.length) }, async () => {
        while (queue.length && !cancelled && enrichId === enrichRequestId.current) {
          const row = queue.shift();
          if (!row || paymentCache.current[row.id]) continue;
          try {
            const detailPayload = await fetchTransactionDetail(session.token, {
              type: row.type,
              sourceId: row.sourceId,
            });
            if (cancelled || enrichId !== enrichRequestId.current) return;
            const enriched = withPaymentBreakdown(row, detailPayload);
            paymentCache.current[row.id] = enriched;
            setRows((current) =>
              current.map((entry) => (entry.id === row.id ? enriched : entry)),
            );
          } catch {
            // leave heuristic flag as-is
          }
        }
      });
      await Promise.all(workers);
    })();

    return () => {
      cancelled = true;
    };
  }, [session?.token, rows.length, startKey, endKey]);

  const columnOptions = useMemo(() => buildColumnOptions(rows), [rows]);

  const employeeCounts = useMemo(() => {
    const counts = {};
    for (const row of rows) {
      const key = row.employeeName || '—';
      counts[key] = (counts[key] || 0) + 1;
    }
    return counts;
  }, [rows]);

  const fintracCount = useMemo(
    () => rows.reduce((count, row) => count + (isFintracCash(row) ? 1 : 0), 0),
    [rows],
  );

  const activeFilterCount = useMemo(
    () =>
      FILTER_COLUMNS.reduce((count, col) => count + (columnFilters[col.key] != null ? 1 : 0), 0) +
      (fintracCashOnly ? 1 : 0),
    [columnFilters, fintracCashOnly],
  );

  const filteredRows = useMemo(() => {
    let result = rows;

    if (fintracCashOnly) {
      result = result.filter((row) => isFintracCash(row));
    }

    for (let i = 0; i < FILTER_COLUMNS.length; i += 1) {
      const key = FILTER_COLUMNS[i].key;
      const filter = columnFilters[key];
      if (filter) {
        result = result.filter((row) => filter[row[key] || '—']);
      }
    }

    const q = query.trim().toLowerCase();
    if (q) {
      result = result.filter((row) => row.searchText.includes(q));
    }

    return result;
  }, [rows, query, columnFilters, fintracCashOnly]);

  const openFilterColumn = openFilter
    ? FILTER_COLUMNS.find((col) => col.key === openFilter)
    : null;

  const clearColumnFilters = () => {
    setColumnFilters({});
    setOpenFilter(null);
    setFintracCashOnly(false);
  };

  const closeDetail = useCallback(() => {
    setSelectedRow(null);
    setDetail(null);
    setDetailError('');
    setDetailLoading(false);
  }, []);

  const ensurePaymentBreakdown = useCallback(
    async (row) => {
      if (!session?.token || !row) return row?.paymentBreakdownLabel || '';
      if (paymentCache.current[row.id]?.paymentBreakdownLabel) {
        return paymentCache.current[row.id].paymentBreakdownLabel;
      }
      if (row.paymentBreakdownLabel && row.paymentBreakdown) {
        return row.paymentBreakdownLabel;
      }

      try {
        const detailPayload = await fetchTransactionDetail(session.token, {
          type: row.type,
          sourceId: row.sourceId,
        });
        const enriched = withPaymentBreakdown(row, detailPayload);
        paymentCache.current[row.id] = enriched;
        setRows((current) =>
          current.map((entry) => (entry.id === row.id ? enriched : entry)),
        );
        return enriched.paymentBreakdownLabel;
      } catch {
        return row.paymentBreakdownLabel || '';
      }
    },
    [session?.token],
  );

  const openDetail = useCallback(
    async (row) => {
      setSelectedRow(row);
      setDetail(null);
      setDetailError('');
      setDetailLoading(true);

      const id = ++detailRequestId.current;

      try {
        const next = await fetchTransactionDetail(session.token, {
          type: row.type,
          sourceId: row.sourceId,
        });
        if (id !== detailRequestId.current) return;
        setDetail(next);
        const enriched = withPaymentBreakdown(row, next);
        paymentCache.current[row.id] = enriched;
        setRows((current) =>
          current.map((entry) => (entry.id === row.id ? enriched : entry)),
        );
        setSelectedRow(enriched);
      } catch (err) {
        if (id !== detailRequestId.current) return;
        setDetailError(err?.message || 'Failed to load transaction details.');
      } finally {
        if (id === detailRequestId.current) setDetailLoading(false);
      }
    },
    [session?.token],
  );

  const renderTransaction = useCallback(
    ({ item }) => (
      <TransactionListRow
        item={item}
        selected={selectedRow?.id === item.id}
        onPress={openDetail}
        employeeCount={employeeCounts[item.employeeName] || 0}
        onAmountHover={ensurePaymentBreakdown}
      />
    ),
    [selectedRow?.id, openDetail, employeeCounts, ensurePaymentBreakdown],
  );
  const keyExtractor = useCallback((item) => item.id, []);

  const selectToday = () => {
    const day = parseDateParam(new Date());
    setDateMode('day');
    setStartDate(day);
    setEndDate(day);
  };

  const selectRange = () => {
    setDateMode('range');
    if (formatDateParam(startDate) === formatDateParam(endDate)) {
      setStartDate(initialRange.start);
      setEndDate(initialRange.end);
    }
  };

  const handleDayChange = (date) => {
    const next = parseDateParam(date);
    setStartDate(next);
    setEndDate(next);
  };

  const handleStartChange = (date) => {
    const next = parseDateParam(date);
    setStartDate(next);
    if (next > endDate) setEndDate(next);
  };

  const handleEndChange = (date) => {
    const next = parseDateParam(date);
    setEndDate(next);
    if (next < startDate) setStartDate(next);
  };

  if (!session?.token) {
    return (
      <View style={styles.transactionsBody}>
        <View style={styles.homeInnerCentered}>
          <Text style={[styles.contentTitle, styles.homeTitle]}>Transactions</Text>
          <Text style={styles.homeSubtitle}>Log in to load Aureus POS transactions.</Text>
          <Pressable style={[styles.loginButton, styles.homeLoginButton]} onPress={onRequireLogin}>
            <Text style={styles.loginButtonText}>Go to Profile</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.transactionsBody}>
      <View style={[styles.txToolbar, isMobile && styles.toolsToolbarMobile]}>
        <View style={[styles.toolsSearch, isMobile && styles.toolsSearchMobile]}>
          <Ionicons name="search" size={16} color="#8e8e93" style={styles.toolsSearchIcon} />
          <TextInput
            style={styles.toolsSearchInput}
            value={query}
            onChangeText={setQuery}
            placeholder="Search"
            placeholderTextColor="#8e8e93"
            autoCapitalize="none"
            autoCorrect={false}
            clearButtonMode="while-editing"
          />
          {query ? (
            <Pressable onPress={() => setQuery('')} hitSlop={8}>
              <Ionicons name="close-circle" size={18} color="#c7c7cc" />
            </Pressable>
          ) : null}
        </View>
      </View>

      <View style={[styles.homeControls, isMobile && styles.homeControlsMobile, styles.txControls]}>
        <View style={styles.homeSegment} accessibilityRole="tablist">
          <Pressable
            style={[
              styles.homeSegmentButton,
              dateMode === 'day' && isToday && styles.homeSegmentButtonActive,
            ]}
            onPress={selectToday}
            accessibilityRole="tab"
            accessibilityState={{ selected: dateMode === 'day' && isToday }}
          >
            <Text
              style={[
                styles.homeSegmentText,
                dateMode === 'day' && isToday && styles.homeSegmentTextActive,
              ]}
            >
              Today
            </Text>
          </Pressable>
          <Pressable
            style={[
              styles.homeSegmentButton,
              dateMode === 'range' && styles.homeSegmentButtonActive,
            ]}
            onPress={selectRange}
            accessibilityRole="tab"
            accessibilityState={{ selected: dateMode === 'range' }}
          >
            <Text
              style={[
                styles.homeSegmentText,
                dateMode === 'range' && styles.homeSegmentTextActive,
              ]}
            >
              Range
            </Text>
          </Pressable>
        </View>

        {dateMode === 'day' ? (
          <DatePickerField
            label="Date"
            value={startDate}
            onChange={handleDayChange}
            maximumDate={new Date()}
            plain
          />
        ) : (
          <>
            <DatePickerField
              label="From"
              value={startDate}
              onChange={handleStartChange}
              maximumDate={endDate}
              plain
            />
            <Text style={styles.homeDateSep}>–</Text>
            <DatePickerField
              label="To"
              value={endDate}
              onChange={handleEndChange}
              minimumDate={startDate}
              maximumDate={new Date()}
              plain
            />
          </>
        )}
      </View>

      <View style={[styles.homeMetaRow, styles.txMetaRow]}>
        <Text style={styles.homeMeta} numberOfLines={1}>
          {loading && rows.length === 0
            ? 'Loading…'
            : `${filteredRows.length}${
                filteredRows.length !== rows.length || query.trim() || fintracCashOnly
                  ? ` of ${rows.length}`
                  : ''
              } transaction${filteredRows.length === 1 ? '' : 's'}`}
          {summary && !query.trim() && activeFilterCount === 0
            ? ` · ${summary.orderCount} sales · ${summary.purchaseCount} purchases`
            : ''}
          {dateMode === 'day' && !query.trim() && activeFilterCount === 0
            ? isToday
              ? ' · today'
              : ` · ${formatPickerDate(startDate)}`
            : ''}
          {activeFilterCount > 0
            ? ` · ${activeFilterCount} filter${activeFilterCount > 1 ? 's' : ''}`
            : ''}
          {fintracCount > 0 && !fintracCashOnly ? ` · ${fintracCount} FINTRAC cash` : ''}
        </Text>
        {fintracCashOnly ? (
          <Text style={styles.fintracFilterBadge}>FINTRAC cash ≥ $10k</Text>
        ) : null}
        {activeFilterCount > 0 ? (
          <Pressable onPress={clearColumnFilters} hitSlop={6}>
            <Text style={styles.clearFiltersText}>Clear</Text>
          </Pressable>
        ) : null}
        {loading && rows.length > 0 ? <ActivityIndicator size="small" color="#8e8e93" /> : null}
      </View>

      {error ? <Text style={[styles.errorText, styles.homeError]}>{error}</Text> : null}

      {loading && rows.length === 0 ? (
        <View style={styles.centered}>
          <ActivityIndicator color="#1d1d1f" />
        </View>
      ) : (
        <View style={styles.txListWrap}>
          <TxTableHeader
            columnFilters={columnFilters}
            fintracCashOnly={fintracCashOnly}
            onOpenFilter={setOpenFilter}
          />
          <FlashList
            data={filteredRows}
            keyExtractor={keyExtractor}
            renderItem={renderTransaction}
            extraData={selectedRow?.id}
            style={styles.tableList}
            contentContainerStyle={styles.txListContent}
            showsVerticalScrollIndicator={false}
            drawDistance={400}
            ListEmptyComponent={
              !loading && !error ? (
                <Text style={styles.homeTxEmpty}>
                  {query.trim() || activeFilterCount > 0
                    ? 'No transactions match the current filters.'
                    : dateMode === 'day'
                      ? isToday
                        ? 'No transactions today.'
                        : `No transactions on ${formatPickerDate(startDate)}.`
                      : 'No transactions in this date range.'}
                </Text>
              ) : null
            }
          />

          {openFilterColumn ? (
            <ColumnFilterMenu
              field={openFilterColumn.key}
              label={openFilterColumn.label}
              options={columnOptions[openFilterColumn.key] || []}
              filter={columnFilters[openFilterColumn.key] ?? null}
              onChange={(next) => {
                setColumnFilters((current) => ({
                  ...current,
                  [openFilterColumn.key]: next,
                }));
              }}
              onClose={() => setOpenFilter(null)}
              fintracOnly={fintracCashOnly}
              onToggleFintrac={() => setFintracCashOnly((current) => !current)}
              fintracCount={fintracCount}
            />
          ) : null}

          <TransactionDetailDrawer
            visible={Boolean(selectedRow)}
            summary={selectedRow}
            detail={detail}
            loading={detailLoading}
            error={detailError}
            onClose={closeDetail}
          />
        </View>
      )}
    </View>
  );
}

function moveArrayItem(array, fromIndex, toIndex) {
  if (
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= array.length ||
    toIndex >= array.length ||
    fromIndex === toIndex
  ) {
    return array;
  }
  const next = array.slice();
  const [item] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, item);
  return next;
}

function SidebarNavItem({
  label,
  icon,
  active,
  collapsed,
  onPress,
  grouped,
  paintChrome = true,
  leading,
  trailing,
  style: extraStyle,
  accessibilityHint,
  webClassName,
  onHoverIn,
  onHoverOut,
  onLayout,
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <Pressable
      onPress={onPress}
      onHoverIn={() => {
        setHovered(true);
        onHoverIn?.();
      }}
      onHoverOut={() => {
        setHovered(false);
        onHoverOut?.();
      }}
      onLayout={onLayout}
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityHint={accessibilityHint}
      {...(Platform.OS === 'web' && webClassName ? { className: webClassName } : null)}
      style={({ pressed, hovered: pressHovered }) => [
        styles.tab,
        collapsed && styles.tabCollapsed,
        extraStyle,
        paintChrome && (pressHovered || pressed) && !active && !grouped && styles.tabHover,
        paintChrome && active && styles.tabActive,
      ]}
    >
      {leading || (
        <Ionicons
          name={active ? filledIonicon(icon) : icon}
          size={20}
          color={active ? '#1d1d1f' : '#6e6e73'}
          style={!collapsed ? styles.tabIcon : undefined}
        />
      )}
      {!collapsed ? (
        <Text
          style={[
            styles.tabLabel,
            hovered && !active && styles.tabLabelHover,
            active && styles.tabLabelActive,
          ]}
          numberOfLines={1}
        >
          {label}
        </Text>
      ) : null}
      {!collapsed ? trailing : null}
    </Pressable>
  );
}

function SidebarNavGroup({
  collapsed,
  homeActive,
  appsActive,
  profileActive,
  onSelectHome,
  onSelectApps,
  onSelectProfile,
  profileLabel,
  profileAvatarUrl,
}) {
  const items = [
    { key: 'home', label: 'Home', icon: 'home-outline', active: homeActive, onPress: onSelectHome },
    { key: 'tools', label: 'Apps', icon: 'apps-outline', active: appsActive, onPress: onSelectApps },
    {
      key: 'profile',
      label: profileLabel || PROFILE_TAB.label,
      icon: PROFILE_TAB.icon,
      active: profileActive,
      onPress: onSelectProfile,
      leading: (
        <ProfileAvatar
          uri={profileAvatarUrl}
          name={profileLabel}
          size={22}
          style={!collapsed ? styles.tabIcon : undefined}
        />
      ),
    },
  ];

  return (
    <View style={[styles.sidebarNavGroup, collapsed && styles.sidebarNavGroupCollapsed]}>
      {items.map((item) => (
        <SidebarNavItem
          key={item.key}
          label={item.label}
          icon={item.icon}
          leading={item.leading}
          active={item.active}
          collapsed={collapsed}
          grouped
          style={styles.sidebarNavItem}
          onPress={item.onPress}
        />
      ))}
    </View>
  );
}

function PinnedToolsList({
  tools,
  activeToolKey,
  sidebarCollapsed,
  onOpen,
  onUnpin,
  onReorder,
}) {
  const listRef = useRef(null);
  const toolsRef = useRef(tools);
  const onReorderRef = useRef(onReorder);
  const draggingKeyRef = useRef(null);
  const didDragRef = useRef(false);
  const suppressPressRef = useRef(false);
  const startYRef = useRef(0);
  const listPageYRef = useRef(0);
  const itemHeightRef = useRef(46);
  const [draggingKey, setDraggingKey] = useState(null);

  toolsRef.current = tools;
  onReorderRef.current = onReorder;

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const endDrag = () => {
      if (!draggingKeyRef.current) return;
      if (didDragRef.current) {
        suppressPressRef.current = true;
      }
      draggingKeyRef.current = null;
      didDragRef.current = false;
      setDraggingKey(null);
    };

    const onPointerMove = (event) => {
      const fromKey = draggingKeyRef.current;
      if (!fromKey) return;

      const pageY = event.clientY;
      if (!didDragRef.current) {
        if (Math.abs(pageY - startYRef.current) < 5) return;
        didDragRef.current = true;
        setDraggingKey(fromKey);
      }

      const currentTools = toolsRef.current;
      const relativeY = pageY - listPageYRef.current;
      const height = itemHeightRef.current || 46;
      let toIndex = Math.floor((relativeY + height / 2) / height);
      toIndex = Math.max(0, Math.min(currentTools.length - 1, toIndex));
      const fromIndex = currentTools.findIndex((tool) => tool.key === fromKey);
      if (fromIndex >= 0 && fromIndex !== toIndex) {
        onReorderRef.current(fromIndex, toIndex);
      }
    };

    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);
    window.addEventListener('pointermove', onPointerMove);
    return () => {
      window.removeEventListener('pointerup', endDrag);
      window.removeEventListener('pointercancel', endDrag);
      window.removeEventListener('pointermove', onPointerMove);
    };
  }, []);

  const measureList = () => {
    listRef.current?.measureInWindow?.((x, y) => {
      listPageYRef.current = y;
    });
  };

  const beginDrag = (toolKey, pageY) => {
    measureList();
    draggingKeyRef.current = toolKey;
    didDragRef.current = false;
    startYRef.current = pageY;
  };

  if (tools.length === 0) return null;

  return (
    <View style={styles.pinnedSection}>
      <View style={styles.pinnedSeparator} />
      <View
        ref={listRef}
        style={styles.pinnedList}
        onLayout={() => {
          measureList();
        }}
      >
        {tools.map((tool) => {
          const isActive = activeToolKey === tool.key;
          const isDragging = draggingKey === tool.key;
          return (
            <Pressable
              key={tool.key}
              onPress={() => {
                if (suppressPressRef.current) {
                  suppressPressRef.current = false;
                  return;
                }
                onOpen(tool);
              }}
              onPointerDown={(event) => {
                if (event?.nativeEvent?.button != null && event.nativeEvent.button !== 0) return;
                beginDrag(tool.key, event.nativeEvent.pageY ?? event.nativeEvent.clientY ?? 0);
              }}
              onLayout={(event) => {
                const { height } = event.nativeEvent.layout;
                if (height > 0) itemHeightRef.current = height + 2;
              }}
              {...(Platform.OS === 'web' ? { className: 'cgold-sidebar-item' } : null)}
              style={({ pressed, hovered }) => [
                styles.tab,
                styles.pinnedTab,
                sidebarCollapsed && styles.tabCollapsed,
                (hovered || pressed) && !isActive && styles.tabHover,
                isActive && styles.tabActive,
                isDragging && styles.pinnedTabDragging,
              ]}
              accessibilityLabel={tool.label}
              accessibilityHint="Drag to reorder"
            >
              <View
                style={[
                  styles.pinnedAppIcon,
                  sidebarCollapsed && styles.pinnedAppIconCollapsed,
                  { backgroundColor: tool.accent },
                ]}
              >
                <Ionicons name={filledIonicon(tool.icon)} size={14} color="#fff" />
              </View>
              {!sidebarCollapsed ? (
                <>
                  <Text
                    style={[styles.tabLabel, isActive && styles.tabLabelActive]}
                    numberOfLines={1}
                  >
                    {tool.label}
                  </Text>
                  <Pressable
                    style={styles.pinnedRemoveButton}
                    {...(Platform.OS === 'web' ? { className: 'cgold-sidebar-unpin' } : null)}
                    onPress={() => onUnpin(tool.key)}
                    onPointerDown={(event) => {
                      event?.stopPropagation?.();
                      draggingKeyRef.current = null;
                    }}
                    hitSlop={6}
                    accessibilityLabel={`Unpin ${tool.label}`}
                  >
                    <Ionicons name="remove-circle-outline" size={16} color="#c7c7cc" />
                  </Pressable>
                </>
              ) : null}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export default function App() {
  const isMobile = useIsMobile();
  const appGrid = useAppGridLayout();
  const [activeTab, setActiveTab] = useState('home');
  const [activeTool, setActiveTool] = useState(null);
  const [settingsPanel, setSettingsPanel] = useState(null);
  const [toolsQuery, setToolsQuery] = useState('');
  const [pinnedKeys, setPinnedKeys] = useState([]);
  const [appsView, setAppsView] = useState(DEFAULT_APPS_VIEW);
  const [appsToolbarHeight, setAppsToolbarHeight] = useState(0);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [session, setSession] = useState(null);
  const [bootstrapping, setBootstrapping] = useState(true);
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [emailsFocus, setEmailsFocus] = useState(null);
  const [accessByRole, setAccessByRole] = useState(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarError, setAvatarError] = useState('');
  const emailsFocusSeq = useRef(0);

  const [fontsLoaded, fontsError] = useFonts(
    Platform.OS === 'web'
      ? {
          Sohne: '/fonts/Sohne-Buch.otf',
          SohneLeicht: '/fonts/Sohne-Leicht.otf',
          SohneMono: '/fonts/SohneMono-Buch.otf',
          ionicons: '/fonts/Ionicons.ttf',
          'material-community': '/fonts/MaterialCommunityIcons.ttf',
        }
      : {
          Sohne: require('./assets/sohne-font-family/TestSohne-Buch-BF663d89cd32e6a.otf'),
          SohneLeicht: require('./assets/sohne-font-family/TestSohne-Leicht-BF663d89cd4952e.otf'),
          SohneMono: require('./assets/sohne-font-family/TestSohneMono-Buch-BF663d89cbcec64.otf'),
          ...Ionicons.font,
          ...MaterialCommunityIcons.font,
        },
  );

  const isLoggedIn = Boolean(session?.token && session?.supabaseUserId);
  const userLabel = displayName(session) || PROFILE_TAB.label;
  const activeLabel =
    activeTab === 'profile'
      ? userLabel
      : MAIN_TABS.find((tab) => tab.key === activeTab)?.label;

  // Always enforced. When role_app_access is unreadable the category defaults
  // apply; there is no "show everything" fallback.
  const allowedToolKeys = useMemo(
    () => new Set(visibleAppKeysForProfile(session?.profile, accessByRole, TOOL_KEYS)),
    [session?.profile, accessByRole],
  );
  const hasApp = useCallback((key) => allowedToolKeys.has(key), [allowedToolKeys]);
  const appAccessValue = useMemo(
    () => ({
      allowedKeys: allowedToolKeys,
      canManageAccess: canManageAppAccess(session?.profile),
      hasApp,
    }),
    [allowedToolKeys, hasApp, session?.profile],
  );

  const normalizedToolsQuery = toolsQuery.trim().toLowerCase();
  const matchesToolsQuery = (tool) =>
    !normalizedToolsQuery || tool.label.toLowerCase().includes(normalizedToolsQuery);

  const pinnedTools = pinnedKeys
    .map((key) => TOOL_CARDS.find((tool) => tool.key === key))
    .filter((tool) => tool && hasApp(tool.key));
  const filteredTools = TOOL_CARDS.filter((tool) => hasApp(tool.key) && matchesToolsQuery(tool));
  const hasSearchResults = filteredTools.length > 0;

  const resetToSignedOut = useCallback(() => {
    clearInventoryCache();
    clearTriageCache();
    setSession(null);
    setPinnedKeys([]);
    setAppsView(DEFAULT_APPS_VIEW);
    setAccessByRole(null);
    setLoginId('');
    setPassword('');
    setLoginError('');
    setActiveTab('home');
    setActiveTool(null);
    setSettingsPanel(null);
    setAvatarError('');
    setAvatarBusy(false);
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      let restored = null;
      try {
        restored = await restoreSession();
      } catch {
        restored = null;
      }
      if (cancelled) return;

      if (restored?.token) {
        const [pins, access, view] = await Promise.all([
          loadPinnedTools(restored, TOOL_KEYS),
          loadRoleAppAccess(TOOL_KEYS),
          loadAppsView(restored),
        ]);
        if (cancelled) return;
        setSession(restored);
        setPinnedKeys(pins);
        setAppsView(view);
        setAccessByRole(access.byRole);
        prefetchInventoryMatrix(restored);
      } else {
        setSession(null);
        setPinnedKeys([]);
        setAppsView(DEFAULT_APPS_VIEW);
        setAccessByRole(null);
      }

      setBootstrapping(false);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // If Supabase revokes the session (another tab signed out, refresh token
  // rejected), drop straight to the login screen.
  const hasSessionRef = useRef(false);
  hasSessionRef.current = Boolean(session?.token);
  useEffect(() => {
    const unsubscribe = onSessionRevoked(() => {
      if (hasSessionRef.current) resetToSignedOut();
    });
    return unsubscribe;
  }, [resetToSignedOut]);

  useEffect(() => {
    if (bootstrapping || !session?.token) return;
    if (!readRipplingOAuthCallback()) return;
    if (!hasApp('employees')) return;
    const employeesTool = TOOL_CARDS.find((tool) => tool.key === 'employees');
    setActiveTab('tools');
    setActiveTool(employeesTool || { key: 'employees', label: 'Employees' });
    setSettingsPanel(null);
    setToolsQuery('');
  }, [bootstrapping, session?.token, hasApp]);

  const selectTab = (tabKey) => {
    setActiveTab(tabKey);
    setSettingsPanel(null);
    if (tabKey === 'tools') {
      setActiveTool(null);
    } else {
      setActiveTool(null);
      setToolsQuery('');
    }
  };

  const openTool = (tool) => {
    if (!hasApp(tool?.key)) return;
    setActiveTool(tool);
    setSettingsPanel(null);
  };

  const openPinnedTool = (tool) => {
    if (!hasApp(tool?.key)) return;
    setActiveTab('tools');
    setActiveTool(tool);
    setSettingsPanel(null);
    setToolsQuery('');
  };

  const openEmailsFromBonuses = useCallback((focus) => {
    if (!hasApp('emails')) return;
    emailsFocusSeq.current += 1;
    setEmailsFocus({
      key: emailsFocusSeq.current,
      storeName: focus?.storeName || null,
      startDate: focus?.startDate,
      endDate: focus?.endDate,
    });
    const emailsTool = TOOL_CARDS.find((tool) => tool.key === 'emails');
    setActiveTab('tools');
    setActiveTool(emailsTool || { key: 'emails', label: 'Emails' });
    setSettingsPanel(null);
    setToolsQuery('');
  }, [hasApp]);

  const togglePin = (toolKey) => {
    setPinnedKeys((current) => {
      const next = current.includes(toolKey)
        ? current.filter((key) => key !== toolKey)
        : [...current, toolKey];
      if (session?.token) {
        persistPinnedTools(session, next, TOOL_KEYS).catch(() => {});
      }
      return next;
    });
  };

  const selectAppsView = (view) => {
    if (view === appsView) return;
    setAppsView(view);
    if (session?.token) {
      persistAppsView(session, view).catch(() => {});
      setSession((current) => {
        if (!current?.profile) return current;
        return { ...current, profile: { ...current.profile, appsView: view } };
      });
    }
  };

  const reorderPinned = useCallback((fromIndex, toIndex) => {
    setPinnedKeys((current) => {
      const next = moveArrayItem(current, fromIndex, toIndex);
      if (next === current) return current;
      if (session?.token) {
        persistPinnedTools(session, next, TOOL_KEYS).catch(() => {});
      }
      return next;
    });
  }, [session?.token]);

  useEffect(() => {
    if (activeTool && !hasApp(activeTool.key)) {
      setActiveTool(null);
      setSettingsPanel(null);
    }
  }, [activeTool, hasApp]);

  const handleLogin = async () => {
    if (!loginId.trim() || !password.trim() || submitting) return;

    setSubmitting(true);
    setLoginError('');

    try {
      const next = await loginRequest(loginId, password);
      const [pins, access, view] = await Promise.all([
        loadPinnedTools(next, TOOL_KEYS),
        loadRoleAppAccess(TOOL_KEYS),
        loadAppsView(next),
      ]);
      setSession(next);
      setPinnedKeys(pins);
      setAppsView(view);
      setAccessByRole(access.byRole);
      prefetchInventoryMatrix(next);
      setPassword('');
      setActiveTab('home');
      setActiveTool(null);
      setSettingsPanel(null);
    } catch (error) {
      setLoginError(error?.message || 'Login failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleLogout = async () => {
    await logoutRequest().catch(() => {});
    resetToSignedOut();
  };

  const handlePickAvatar = async () => {
    if (avatarBusy) return;
    setAvatarError('');

    try {
      if (Platform.OS !== 'web') {
        const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!permission.granted) {
          setAvatarError('Allow photo access to set a profile picture.');
          return;
        }
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.7,
      });
      if (result.canceled || !result.assets?.[0]) return;

      setAvatarBusy(true);
      const avatarUrl = await uploadOwnAvatar(result.assets[0]);
      setSession((current) => {
        if (!current?.profile) return current;
        return { ...current, profile: { ...current.profile, avatarUrl } };
      });
    } catch (error) {
      setAvatarError(error?.message || 'Could not save that photo.');
    } finally {
      setAvatarBusy(false);
    }
  };

  const renderToolsHeader = () => {
    if (!activeTool) {
      return null;
    }

    const settingsSubPanels = {
      'ai-models': 'AI models',
      permissions: 'Permissions',
      database: 'Database',
      'store-settings': 'Store settings',
    };
    const settingsSubPanelLabel =
      activeTool.key === 'settings' ? settingsSubPanels[settingsPanel] : null;

    if (isMobile) {
      return (
        <View style={styles.mobileAppHeader}>
          <Pressable
            onPress={() => {
              if (settingsSubPanelLabel) {
                setSettingsPanel(null);
                return;
              }
              setActiveTool(null);
              setSettingsPanel(null);
            }}
            style={styles.mobileBackButton}
            hitSlop={8}
            accessibilityLabel="Back"
          >
            <Ionicons name="chevron-back" size={22} color="#1a1a1a" />
          </Pressable>
          <Text style={styles.mobileAppTitle} numberOfLines={1}>
            {settingsSubPanelLabel || activeTool.label}
          </Text>
          <View style={styles.mobileBackButtonSpacer} />
        </View>
      );
    }

    return (
      <View style={styles.breadcrumb}>
        <Pressable
          onPress={() => {
            setActiveTool(null);
            setSettingsPanel(null);
          }}
          style={styles.breadcrumbLink}
        >
          <Text style={styles.breadcrumbLinkText}>Apps</Text>
        </Pressable>
        <Text style={styles.breadcrumbSep}>›</Text>
        {settingsSubPanelLabel ? (
          <>
            <Pressable onPress={() => setSettingsPanel(null)} style={styles.breadcrumbLink}>
              <Text style={styles.breadcrumbLinkText}>{activeTool.label}</Text>
            </Pressable>
            <Text style={styles.breadcrumbSep}>›</Text>
            <Text style={styles.breadcrumbCurrent}>{settingsSubPanelLabel}</Text>
          </>
        ) : (
          <Text style={styles.breadcrumbCurrent}>{activeTool.label}</Text>
        )}
      </View>
    );
  };

  const renderContent = () => {
    if (activeTab === 'profile') {
      const linkedSystems = Object.values(session?.linked || {});
      const profile = session?.profile;
      const storeName = storeLocationFromSession(session);
      const accessLabel = categoryLabel(profile);
      const name = displayName(session);
      const email = profile?.email || session?.login || '';
      const sectionWidth = appGrid.maxWidth ? { maxWidth: appGrid.maxWidth } : null;
      const accountRows = [
        {
          key: 'store',
          label: 'Store',
          value: storeName || 'Not set in Aureus',
        },
        accessLabel
          ? { key: 'category', label: 'Category', value: accessLabel }
          : null,
        profile?.employeeType
          ? { key: 'employeeType', label: 'Employee type', value: profile.employeeType }
          : null,
        profile?.role && profile.role !== profile.employeeType
          ? { key: 'role', label: 'Aureus role', value: profile.role }
          : null,
      ].filter(Boolean);

      return (
        <View style={styles.toolsScreen}>
          <ScrollView
            style={styles.toolsScroll}
            contentContainerStyle={styles.toolsScrollContent}
            showsVerticalScrollIndicator={false}
          >
            <View
              style={[
                styles.toolsSection,
                isMobile && styles.toolsSectionMobile,
                sectionWidth,
              ]}
            >
              <View style={styles.profileHero}>
                <Pressable
                  onPress={handlePickAvatar}
                  disabled={avatarBusy}
                  style={styles.profileAvatarButton}
                  accessibilityRole="button"
                  accessibilityLabel={
                    profile?.avatarUrl ? 'Change profile picture' : 'Add a profile picture'
                  }
                >
                  <ProfileAvatar
                    uri={profile?.avatarUrl || ''}
                    name={name}
                    size={88}
                    style={styles.profileAvatar}
                  />
                  <View style={styles.profileAvatarCamera}>
                    {avatarBusy ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <Ionicons name="camera" size={14} color="#fff" />
                    )}
                  </View>
                </Pressable>
                <Text style={styles.profileName}>{name || 'Profile'}</Text>
                {email ? <Text style={styles.profileEmail}>{email}</Text> : null}
                <Pressable onPress={handlePickAvatar} disabled={avatarBusy} hitSlop={6}>
                  <Text style={styles.profilePhotoAction}>
                    {avatarBusy
                      ? 'Saving…'
                      : profile?.avatarUrl
                        ? 'Change photo'
                        : 'Add a profile picture'}
                  </Text>
                </Pressable>
                {avatarError ? (
                  <Text style={[styles.errorText, styles.profileError]}>{avatarError}</Text>
                ) : null}
              </View>

              {accountRows.length > 0 ? (
                <>
                  <Text style={styles.appleSheetSectionLabel}>Account</Text>
                  <View style={styles.toolsList}>
                    {accountRows.map((row, index) => (
                      <AppleDetailRow
                        key={row.key}
                        label={row.label}
                        value={row.value}
                        last={index === accountRows.length - 1}
                      />
                    ))}
                  </View>
                  <Text style={styles.profileGroupFooter}>
                    Current store from Aureus POS. Change it there to update this profile.
                  </Text>
                </>
              ) : null}

              {linkedSystems.length > 0 ? (
                <View style={styles.profileLinkedBlock}>
                  <Text style={styles.appleSheetSectionLabel}>Linked POS</Text>
                  <View style={styles.toolsList}>
                    {linkedSystems.map((linked, index) => (
                      <AppleDetailRow
                        key={linked.key}
                        label={linked.label}
                        value={linked.token ? 'Connected' : linked.error || 'Not connected'}
                        last={index === linkedSystems.length - 1}
                      />
                    ))}
                  </View>
                </View>
              ) : null}

              <View style={[styles.toolsList, styles.profileLogoutGroup]}>
                <Pressable
                  onPress={handleLogout}
                  style={({ hovered, pressed }) => [
                    styles.profileLogoutRow,
                    (hovered || pressed) && styles.toolListRowHovered,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Log out"
                >
                  <Text style={styles.profileLogoutText}>Log Out</Text>
                </Pressable>
              </View>
            </View>
          </ScrollView>
        </View>
      );
    }

    if (activeTab === 'tools') {
      if (activeTool) {
        return (
          <View style={styles.toolsScreen}>
            {renderToolsHeader()}
            {activeTool.key === 'transactions' ? (
              <TransactionsScreen
                session={session}
                onRequireLogin={() => selectTab('profile')}
              />
            ) : activeTool.key === 'inventory' ? (
              <InventoryScreen
                session={session}
                onRequireLogin={() => selectTab('profile')}
              />
            ) : activeTool.key === 'preorders' ? (
              <PreordersScreen />
            ) : activeTool.key === 'ai' ? (
              <AiScreen
                session={session}
                onRequireLogin={() => selectTab('profile')}
              />
            ) : activeTool.key === 'financials' ? (
              <FinancialsScreen
                session={session}
                onRequireLogin={() => selectTab('profile')}
              />
            ) : activeTool.key === 'accounting' ? (
              <AccountingScreen />
            ) : activeTool.key === 'audit' ? (
              <AuditScreen
                session={session}
                onRequireLogin={() => selectTab('profile')}
              />
            ) : activeTool.key === 'emails' ? (
              <EmailsScreen
                session={session}
                onRequireLogin={() => selectTab('profile')}
                focus={emailsFocus}
                onFocusConsumed={() => setEmailsFocus(null)}
              />
            ) : activeTool.key === 'serphint' ? (
              <SerphintScreen />
            ) : activeTool.key === '100-ways' ? (
              <HundredWaysScreen
                session={session}
                onRequireLogin={() => selectTab('profile')}
              />
            ) : activeTool.key === 'settings' ? (
              <SettingsScreen
                panel={settingsPanel}
                onOpenPanel={setSettingsPanel}
                session={session}
                apps={TOOL_CARDS}
                onAccessSaved={(next) => {
                  setAccessByRole(next);
                }}
                onStaffAccessSaved={(staff) => {
                  setSession((current) => {
                    if (!current?.profile || current.profile.id !== staff.id) return current;
                    return {
                      ...current,
                      profile: {
                        ...current.profile,
                        appRole: staff.appRole,
                        isSystemAdmin: staff.isSystemAdmin,
                      },
                    };
                  });
                }}
              />
            ) : activeTool.key === 'transfer' ? (
              <TransferScreen
                session={session}
                onRequireLogin={() => selectTab('profile')}
              />
            ) : activeTool.key === 'fintrac' ? (
              <FintracScreen
                session={session}
                onRequireLogin={() => selectTab('profile')}
              />
            ) : activeTool.key === 'trends' ? (
              <TrendsScreen
                session={session}
                onRequireLogin={() => selectTab('profile')}
              />
            ) : activeTool.key === 'bonuses' ? (
              <BonusesScreen
                session={session}
                onRequireLogin={() => selectTab('profile')}
                onOpenEmails={openEmailsFromBonuses}
              />
            ) : activeTool.key === 'employees' ? (
              <EmployeesScreen
                session={session}
                onProfileUpdated={(profile) => {
                  setSession((current) => {
                    if (!current?.profile || current.profile.id !== profile.id) return current;
                    if (
                      current.profile.appRole === (profile.appRole ?? current.profile.appRole) &&
                      current.profile.employeeType ===
                        (profile.employeeType ?? current.profile.employeeType) &&
                      current.profile.role === (profile.role ?? current.profile.role)
                    ) {
                      return current;
                    }
                    return {
                      ...current,
                      profile: {
                        ...current.profile,
                        role: profile.role ?? current.profile.role,
                        employeeType: profile.employeeType ?? current.profile.employeeType,
                        locationId: profile.locationId ?? current.profile.locationId,
                        locationName: profile.locationName ?? current.profile.locationName,
                        appRole: profile.appRole ?? current.profile.appRole,
                        isSystemAdmin: profile.isSystemAdmin ?? current.profile.isSystemAdmin,
                      },
                    };
                  });
                }}
              />
            ) : activeTool.key === 'triage' ? (
              <TriageScreen
                session={session}
                onRequireLogin={() => selectTab('profile')}
              />
            ) : (
              <Text style={styles.toolPageBody}>{activeTool.label} page</Text>
            )}
          </View>
        );
      }

      return (
        <View style={styles.toolsScreen}>
          <ScrollView
            style={styles.toolsScroll}
            contentContainerStyle={[
              styles.toolsScrollContent,
              isMobile ? styles.appsLibraryScrollContentMobile : styles.appsLibraryScrollContent,
              { paddingTop: appsToolbarHeight || (isMobile ? 72 : 90) },
            ]}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {!hasSearchResults ? (
              <Text
                style={[
                  styles.toolsEmpty,
                  appGrid.maxWidth ? { maxWidth: appGrid.maxWidth } : null,
                ]}
              >
                No apps match “{toolsQuery.trim()}”.
              </Text>
            ) : (
              <View
                style={[
                  styles.toolsSection,
                  isMobile && styles.toolsSectionMobile,
                  appGrid.maxWidth ? { maxWidth: appGrid.maxWidth } : null,
                ]}
              >
                {appsView === 'list' ? (
                  <ToolsList
                    tools={filteredTools}
                    pinnedKeys={pinnedKeys}
                    onOpen={openTool}
                    onTogglePin={togglePin}
                  />
                ) : (
                  <ToolsGrid
                    tools={filteredTools}
                    pinnedKeys={pinnedKeys}
                    onOpen={openTool}
                    onTogglePin={togglePin}
                    columns={appGrid.columns}
                    iconSize={appGrid.iconSize}
                    gap={appGrid.gap}
                    rowGap={appGrid.rowGap}
                  />
                )}
              </View>
            )}
          </ScrollView>

          <BlurView
            intensity={58}
            tint="light"
            style={[styles.toolsToolbarBlur, isMobile && styles.toolsToolbarBlurMobile]}
            onLayout={(event) => {
              const next = Math.ceil(event.nativeEvent.layout.height);
              if (next > 0 && next !== appsToolbarHeight) setAppsToolbarHeight(next);
            }}
            {...(Platform.OS === 'web' ? { className: 'cgold-apps-toolbar-blur' } : null)}
          >
            <View
              style={[
                styles.toolsToolbar,
                styles.toolsToolbarOverlay,
                isMobile && styles.toolsToolbarMobile,
                appGrid.maxWidth ? { maxWidth: appGrid.maxWidth } : null,
              ]}
            >
              <View style={[styles.toolsSearch, isMobile && styles.toolsSearchMobile]}>
                <Ionicons name="search" size={16} color="#8e8e93" style={styles.toolsSearchIcon} />
                <TextInput
                  style={styles.toolsSearchInput}
                  value={toolsQuery}
                  onChangeText={setToolsQuery}
                  placeholder="Search"
                  placeholderTextColor="#8e8e93"
                  autoCapitalize="none"
                  autoCorrect={false}
                  clearButtonMode="while-editing"
                />
                {toolsQuery ? (
                  <Pressable onPress={() => setToolsQuery('')} hitSlop={8}>
                    <Ionicons name="close-circle" size={18} color="#c7c7cc" />
                  </Pressable>
                ) : null}
              </View>
              <View style={styles.appsViewToggle} accessibilityRole="tablist">
                <Pressable
                  style={[
                    styles.appsViewToggleButton,
                    appsView === 'grid' && styles.appsViewToggleButtonActive,
                  ]}
                  onPress={() => selectAppsView('grid')}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: appsView === 'grid' }}
                  accessibilityLabel="Grid view"
                >
                  <Ionicons
                    name={appsView === 'grid' ? 'grid' : 'grid-outline'}
                    size={16}
                    color={appsView === 'grid' ? '#1d1d1f' : '#8e8e93'}
                  />
                </Pressable>
                <Pressable
                  style={[
                    styles.appsViewToggleButton,
                    appsView === 'list' && styles.appsViewToggleButtonActive,
                  ]}
                  onPress={() => selectAppsView('list')}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: appsView === 'list' }}
                  accessibilityLabel="List view"
                >
                  <Ionicons
                    name={appsView === 'list' ? 'list' : 'list-outline'}
                    size={18}
                    color={appsView === 'list' ? '#1d1d1f' : '#8e8e93'}
                  />
                </Pressable>
              </View>
            </View>
          </BlurView>
        </View>
      );
    }

    if (activeTab === 'home') {
      return (
        <HomeScreen
          session={session}
          onRequireLogin={() => selectTab('profile')}
        />
      );
    }

    return <Text style={styles.contentTitle}>{activeLabel}</Text>;
  };

  const isFullBleedTool =
    activeTab === 'tools' &&
    (activeTool?.key === 'transactions' ||
      activeTool?.key === 'inventory' ||
      activeTool?.key === 'audit' ||
      activeTool?.key === 'serphint' ||
      activeTool?.key === 'financials' ||
      activeTool?.key === 'transfer' ||
      activeTool?.key === 'fintrac' ||
      activeTool?.key === 'bonuses' ||
      activeTool?.key === 'employees' ||
      activeTool?.key === 'triage');

  const isAppsLibrary = activeTab === 'tools' && !activeTool;
  const contentStyle = [
    styles.content,
    isMobile && styles.contentMobile,
    isFullBleedTool && styles.contentTransactions,
    isMobile && activeTab === 'tools' && activeTool && styles.contentMobileApp,
    styles.contentScrollFix,
    isAppsLibrary && styles.contentAppsLibrary,
  ];

  if (bootstrapping || (!fontsLoaded && !fontsError)) {
    return (
      <View style={styles.loginShell}>
        <StatusBar style="auto" />
        <View style={styles.centered}>
          <ActivityIndicator color="#1a1a1a" />
        </View>
      </View>
    );
  }

  if (!isLoggedIn) {
    return (
      <View style={styles.loginShell}>
        <StatusBar style="auto" />
        <LoginScreen
          loginId={loginId}
          password={password}
          error={loginError}
          submitting={submitting}
          onChangeLoginId={setLoginId}
          onChangePassword={setPassword}
          onSubmit={handleLogin}
        />
      </View>
    );
  }

  if (isMobile) {
    return (
      <AppAccessContext.Provider value={appAccessValue}>
        <View style={styles.containerMobile}>
        <StatusBar style="auto" />

        <View style={styles.mobileTopBar}>
          <View style={styles.brandIcon}>
            <MaterialCommunityIcons name="gold" size={14} color="#B8860B" />
          </View>
          <Text style={styles.mobileTopTitle} numberOfLines={1}>
            MyCanadaGold
          </Text>
          <Pressable
            onPress={() => selectTab(PROFILE_TAB.key)}
            style={[
              styles.mobileProfileButton,
              activeTab === PROFILE_TAB.key && styles.mobileProfileButtonActive,
            ]}
            accessibilityLabel={isLoggedIn ? userLabel : PROFILE_TAB.label}
            hitSlop={8}
          >
            <ProfileAvatar
              uri={session?.profile?.avatarUrl || ''}
              name={userLabel}
              size={28}
            />
          </Pressable>
        </View>

        <View style={contentStyle}>{renderContent()}</View>

        <View style={styles.bottomTabBar}>
          {MAIN_TABS.map((tab) => {
            const isActive = activeTab === tab.key;
            const iconName = isActive
              ? tab.icon.replace('-outline', '')
              : tab.icon;
            return (
              <Pressable
                key={tab.key}
                onPress={() => selectTab(tab.key)}
                style={styles.bottomTab}
                accessibilityLabel={tab.label}
                accessibilityRole="button"
                accessibilityState={{ selected: isActive }}
              >
                <Ionicons
                  name={iconName}
                  size={22}
                  color={isActive ? '#1a1a1a' : '#8a8a8a'}
                />
                <Text style={[styles.bottomTabLabel, isActive && styles.bottomTabLabelActive]}>
                  {tab.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
      </AppAccessContext.Provider>
    );
  }

  return (
    <AppAccessContext.Provider value={appAccessValue}>
    <View style={styles.container}>
      <StatusBar style="auto" />

      <View style={[styles.sidebar, sidebarCollapsed && styles.sidebarCollapsed]}>
        <View style={[styles.sidebarHeader, sidebarCollapsed && styles.sidebarHeaderCollapsed]}>
          <Pressable
            onPress={() => selectTab('home')}
            style={({ pressed, hovered }) => [
              styles.sidebarBrand,
              sidebarCollapsed && styles.sidebarBrandCollapsed,
              (hovered || pressed) && styles.tabHover,
            ]}
            accessibilityLabel="MyCanadaGold"
          >
            <View style={styles.sidebarBrandIcon}>
              <MaterialCommunityIcons name="gold" size={16} color="#B8860B" />
            </View>
            {!sidebarCollapsed ? (
              <Text style={styles.sidebarTitle} numberOfLines={1}>
                MyCanadaGold
              </Text>
            ) : null}
          </Pressable>
        </View>

        <View style={styles.tabList}>
          <SidebarNavGroup
            collapsed={sidebarCollapsed}
            homeActive={activeTab === 'home'}
            appsActive={
              activeTab === 'tools' &&
              !pinnedTools.some((tool) => tool.key === activeTool?.key)
            }
            profileActive={activeTab === PROFILE_TAB.key}
            onSelectHome={() => selectTab('home')}
            onSelectApps={() => selectTab('tools')}
            onSelectProfile={() => selectTab(PROFILE_TAB.key)}
            profileLabel={userLabel}
            profileAvatarUrl={session?.profile?.avatarUrl || ''}
          />

          <PinnedToolsList
            tools={pinnedTools}
            activeToolKey={activeTab === 'tools' ? activeTool?.key : null}
            sidebarCollapsed={sidebarCollapsed}
            onOpen={openPinnedTool}
            onUnpin={togglePin}
            onReorder={reorderPinned}
          />
        </View>

        <View style={[styles.sidebarFooter, sidebarCollapsed && styles.sidebarFooterCollapsed]}>
          <Pressable
            onPress={() => setSidebarCollapsed((current) => !current)}
            style={styles.sidebarToggle}
            accessibilityLabel={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <Ionicons
              name={sidebarCollapsed ? 'chevron-forward' : 'chevron-back'}
              size={16}
              color="#6e6e73"
            />
          </Pressable>
        </View>
      </View>

      <View style={contentStyle}>{renderContent()}</View>
    </View>
    </AppAccessContext.Provider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: '#fff',
    ...Platform.select({
      web: { height: '100%', maxHeight: '100dvh', overflow: 'hidden' },
      default: {},
    }),
  },
  loginShell: {
    flex: 1,
    backgroundColor: '#fff',
  },
  containerMobile: {
    flex: 1,
    flexDirection: 'column',
    backgroundColor: '#fff',
    ...Platform.select({
      web: { height: '100%', maxHeight: '100dvh', overflow: 'hidden' },
      default: {},
    }),
  },
  mobileTopBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 54 : 14,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e5e5',
    backgroundColor: '#fafafa',
    gap: 10,
  },
  mobileTopTitle: {
    fontFamily: titleFontFamily,
    flex: 1,
    fontSize: 16,
    fontWeight: '400',
    color: '#1a1a1a',
  },
  mobileProfileButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f0f0f0',
  },
  mobileProfileButtonActive: {
    backgroundColor: '#e4e4e4',
  },
  bottomTabBar: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e5e5e5',
    backgroundColor: '#fafafa',
    paddingBottom: Platform.OS === 'ios' ? 20 : 8,
    paddingTop: 8,
  },
  bottomTab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    minHeight: 44,
    ...Platform.select({
      web: {
        cursor: 'pointer',
      },
      default: {},
    }),
  },
  bottomTabLabel: {
    fontFamily,
    fontSize: 11,
    fontWeight: '500',
    color: '#8a8a8a',
  },
  bottomTabLabelActive: {
    color: '#1a1a1a',
    fontWeight: '600',
  },
  mobileAppHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    minHeight: 36,
  },
  mobileBackButton: {
    width: 36,
    height: 36,
    marginLeft: -8,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      web: {
        cursor: 'pointer',
      },
      default: {},
    }),
  },
  mobileBackButtonSpacer: {
    width: 36,
  },
  mobileAppTitle: {
    fontFamily,
    flex: 1,
    fontSize: 18,
    fontWeight: '600',
    color: '#1a1a1a',
    textAlign: 'center',
  },
  sidebar: {
    width: 252,
    paddingTop: 16,
    paddingBottom: 14,
    paddingHorizontal: 12,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: '#e5e5ea',
    backgroundColor: '#fff',
  },
  sidebarCollapsed: {
    width: 72,
    paddingHorizontal: 10,
  },
  sidebarHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 32,
  },
  sidebarHeaderCollapsed: {
    flexDirection: 'column',
    marginBottom: 28,
  },
  sidebarBrand: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 10,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  sidebarBrandCollapsed: {
    flex: 0,
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  sidebarTitle: {
    fontFamily: titleFontFamily,
    flex: 1,
    minWidth: 0,
    marginLeft: 10,
    fontSize: 17,
    fontWeight: '400',
    color: '#1d1d1f',
    letterSpacing: -0.4,
  },
  sidebarToggle: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
    backgroundColor: '#e8e8ed',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  sidebarNavGroup: {
    backgroundColor: '#e8e8ed',
    borderRadius: 12,
    padding: 2,
    gap: 2,
  },
  sidebarNavGroupCollapsed: {
    alignItems: 'stretch',
  },
  sidebarNavItem: {
    backgroundColor: 'transparent',
  },
  sidebarFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    marginTop: 'auto',
    paddingTop: 10,
  },
  sidebarFooterCollapsed: {
    flexDirection: 'column',
    alignItems: 'flex-start',
  },
  sidebarBrandIcon: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFF8E8',
  },
  brandIcon: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFF8E8',
    ...Platform.select({
      web: {
        cursor: 'pointer',
      },
      default: {},
    }),
  },
  tabList: {
    flex: 1,
    gap: 0,
  },
  pinnedSection: {
    marginTop: 0,
  },
  pinnedSeparator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#e5e5ea',
    marginTop: 22,
    marginBottom: 22,
    marginHorizontal: 10,
  },
  pinnedList: {
    gap: 2,
  },
  pinnedAppIcon: {
    width: 28,
    height: 28,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  pinnedAppIconCollapsed: {
    marginRight: 0,
  },
  pinnedTab: {
    paddingRight: 6,
    ...Platform.select({
      web: {
        cursor: 'grab',
        userSelect: 'none',
      },
      default: {},
    }),
  },
  pinnedTabDragging: {
    opacity: 0.55,
    backgroundColor: '#fff',
    ...Platform.select({
      web: {
        cursor: 'grabbing',
      },
      default: {},
    }),
  },
  pinnedRemoveButton: {
    marginLeft: 'auto',
    padding: 2,
    ...Platform.select({
      web: {
        cursor: 'pointer',
      },
      default: {},
    }),
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 42,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 10,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  tabCollapsed: {
    justifyContent: 'center',
    paddingHorizontal: 6,
    paddingRight: 6,
  },
  tabHover: {
    backgroundColor: '#e8e8ed',
  },
  tabActive: {
    backgroundColor: '#fff',
    ...Platform.select({
      web: {
        boxShadow: '0 1px 2px rgba(0,0,0,0.12)',
      },
      default: {
        elevation: 1,
      },
    }),
  },
  tabIcon: {
    marginRight: 10,
  },
  tabLabel: {
    fontFamily,
    fontSize: 15,
    fontWeight: '500',
    color: '#6e6e73',
    letterSpacing: -0.2,
    flexShrink: 1,
  },
  tabLabelHover: {
    color: '#1d1d1f',
  },
  tabLabelActive: {
    color: '#1d1d1f',
    fontWeight: '600',
  },
  content: {
    flex: 1,
    minHeight: 0,
    padding: 32,
  },
  contentMobile: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
  },
  contentMobileApp: {
    paddingTop: 10,
  },
  contentScrollFix: {
    ...Platform.select({
      web: { overflow: 'hidden', display: 'flex', flexDirection: 'column' },
      default: {},
    }),
  },
  contentAppsLibrary: {
    paddingTop: 0,
    paddingBottom: 0,
    paddingHorizontal: 0,
  },
  contentTransactions: {
    paddingBottom: 0,
    paddingTop: 24,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  contentTitle: {
    fontFamily,
    fontSize: 20,
    fontWeight: '600',
    color: '#1a1a1a',
    alignSelf: 'stretch',
  },
  homeInnerCentered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  homeLoginButton: {
    alignSelf: 'center',
    minWidth: 160,
    paddingHorizontal: 24,
    marginTop: 16,
  },
  homeTitle: {
    textAlign: 'center',
  },
  homeSubtitle: {
    fontFamily,
    fontSize: 15,
    color: '#8e8e93',
    marginTop: 6,
    textAlign: 'center',
  },
  homeError: {
    textAlign: 'center',
    marginBottom: 8,
    width: '100%',
    alignSelf: 'center',
  },
  homeControls: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 10,
    marginTop: 10,
    marginBottom: 4,
    width: '100%',
    maxWidth: APP_GRID_MAX_WIDTH,
    alignSelf: 'center',
  },
  homeControlsMobile: {
    maxWidth: '100%',
  },
  homeSegment: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 0,
    backgroundColor: '#e8e8ed',
    borderRadius: 10,
    padding: 2,
  },
  homeSegmentButton: {
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
  homeSegmentButtonActive: {
    backgroundColor: '#fff',
    ...Platform.select({
      web: {
        boxShadow: '0 1px 2px rgba(0,0,0,0.12)',
      },
      default: {
        elevation: 1,
      },
    }),
  },
  homeSegmentText: {
    fontFamily,
    fontSize: 15,
    fontWeight: '500',
    color: '#8e8e93',
    letterSpacing: -0.2,
  },
  homeSegmentTextActive: {
    color: '#1d1d1f',
    fontWeight: '600',
  },
  homeDateField: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#e8e8ed',
    borderRadius: 12,
    paddingHorizontal: 12,
    minHeight: 42,
    justifyContent: 'center',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  homeDateFieldValue: {
    fontSize: 16,
    color: '#1d1d1f',
    letterSpacing: -0.2,
  },
  homeDateSep: {
    fontFamily,
    fontSize: 16,
    color: '#c7c7cc',
  },
  homeListMeta: {
    fontFamily,
    fontSize: 15,
    color: '#8e8e93',
    fontVariant: ['tabular-nums'],
    marginRight: 10,
    flexShrink: 0,
  },
  homeListAmount: {
    fontFamily,
    fontSize: 17,
    fontWeight: '400',
    color: '#1d1d1f',
    letterSpacing: -0.2,
    fontVariant: ['tabular-nums'],
    marginRight: 4,
    flexShrink: 0,
  },
  homeStoreTableCard: {
    backgroundColor: '#f2f2f7',
    borderRadius: 14,
    overflow: 'hidden',
    width: '100%',
  },
  homeStoreTableScroll: {
    width: '100%',
  },
  homeStoreTableScrollContent: {
    flexGrow: 1,
  },
  homeStoreTable: {
    flexGrow: 1,
    minWidth: 860,
  },
  homeStoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 40,
    paddingRight: 10,
    gap: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e5ea',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  homeStoreRowLast: {
    borderBottomWidth: 0,
  },
  homeStoreRowSelected: {
    backgroundColor: '#e8e8ed',
  },
  homeStoreHeaderRow: {
    backgroundColor: '#ebebf0',
    minHeight: 30,
    paddingVertical: 4,
    borderBottomColor: '#e5e5ea',
    ...Platform.select({
      web: {
        cursor: 'default',
        position: 'sticky',
        top: 0,
        zIndex: 3,
      },
      default: {},
    }),
  },
  homeStoreTotalRow: {
    backgroundColor: '#ebebf0',
    minHeight: 38,
    borderBottomWidth: 0,
    ...Platform.select({
      web: { cursor: 'default' },
      default: {},
    }),
  },
  homeStoreAccent: {
    width: 3,
    alignSelf: 'stretch',
    borderRadius: 1,
    marginVertical: 8,
    marginLeft: 8,
    flexShrink: 0,
  },
  homeStoreHeader: {
    fontFamily,
    fontSize: 11,
    fontWeight: '600',
    color: '#8e8e93',
    letterSpacing: -0.08,
  },
  homeStoreName: {
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: '#1d1d1f',
    letterSpacing: -0.24,
  },
  homeStoreNum: {
    fontFamily,
    fontSize: 14,
    fontWeight: '500',
    color: '#1d1d1f',
    letterSpacing: -0.08,
    fontVariant: ['tabular-nums'],
  },
  homeStoreMoney: {
    fontFamily,
    fontSize: 14,
    fontWeight: '500',
    color: '#1d1d1f',
    letterSpacing: -0.16,
    fontVariant: ['tabular-nums'],
  },
  homeStoreSecondary: {
    fontWeight: '400',
    color: '#6e6e73',
  },
  homeStoreTotalLabel: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: '#1d1d1f',
    letterSpacing: -0.08,
  },
  homeStoreTotalValue: {
    fontWeight: '600',
    color: '#1d1d1f',
  },
  homeStoreColStore: {
    flex: 1.4,
    minWidth: 168,
    paddingRight: 10,
    ...Platform.select({
      web: { whiteSpace: 'nowrap' },
      default: {},
    }),
  },
  homeStoreColCount: {
    width: 52,
    flexShrink: 0,
    textAlign: 'right',
    ...Platform.select({
      web: { whiteSpace: 'nowrap' },
      default: {},
    }),
  },
  homeStoreColMoney: {
    width: 124,
    flexShrink: 0,
    textAlign: 'right',
    ...Platform.select({
      web: { whiteSpace: 'nowrap' },
      default: {},
    }),
  },
  homeStoreChevronSpacer: {
    width: 14,
    flexShrink: 0,
  },
  homeMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
    marginBottom: 2,
    minHeight: 18,
    width: '100%',
    maxWidth: APP_GRID_MAX_WIDTH,
    alignSelf: 'center',
  },
  homeMeta: {
    fontFamily,
    flex: 1,
    fontSize: 13,
    color: '#8e8e93',
    letterSpacing: -0.08,
  },
  homeTableWrap: {
    backgroundColor: 'transparent',
    overflow: 'hidden',
    alignSelf: 'stretch',
    flex: 1,
    minHeight: 0,
  },
  homeTableScroll: {
    flex: 1,
    minHeight: 0,
  },
  homeTableListContent: {
    paddingBottom: 8,
  },
  homeTableHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 4,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e8e8e8',
    backgroundColor: 'transparent',
  },
  homeHeaderCell: {
    fontFamily,
    fontSize: 11,
    fontWeight: '600',
    color: '#9a9a9a',
    letterSpacing: 0.2,
  },
  homeTableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 4,
    paddingVertical: 8,
    minHeight: 34,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f2f2f2',
    ...Platform.select({
      web: {
        cursor: 'pointer',
      },
      default: {},
    }),
  },
  homeTableRowHover: {
    backgroundColor: '#f7f7f7',
  },
  homeTableRowSelected: {
    backgroundColor: '#f0f0f0',
  },
  homeTableEmpty: {
    paddingVertical: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  homeColStore: {
    flex: 1.35,
    minWidth: 0,
    paddingRight: 12,
  },
  homeColNum: {
    width: 48,
    flexShrink: 0,
    textAlign: 'right',
    paddingRight: 8,
  },
  homeColMoney: {
    width: 92,
    flexShrink: 0,
    textAlign: 'right',
    paddingRight: 8,
  },
  homeColTx: {
    flex: 1.35,
    minWidth: 200,
    paddingRight: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  homeColAmount: {
    flex: 1.7,
    minWidth: 260,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  homeCellStore: {
    flex: 1,
    minWidth: 0,
    fontFamily,
    fontSize: 13,
    lineHeight: 16,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  homeCellEmailStore: {
    fontFamily,
    fontSize: 13,
    lineHeight: 16,
    fontWeight: '500',
    color: '#1a1a1a',
    flex: 1.05,
    minWidth: 110,
    paddingRight: 20,
  },
  homeCellCount: {
    fontFamily,
    fontSize: 13,
    lineHeight: 16,
    fontWeight: '500',
    color: '#1a1a1a',
    width: 28,
    fontVariant: ['tabular-nums'],
  },
  homeCellAmount: {
    fontFamily,
    fontSize: 13,
    lineHeight: 16,
    fontWeight: '500',
    color: '#1a1a1a',
    width: 108,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  homeCellPrimary: {
    fontFamily,
    fontSize: 13,
    lineHeight: 16,
    fontWeight: '500',
    color: '#1a1a1a',
    fontVariant: ['tabular-nums'],
  },
  homeCellSecondary: {
    fontFamily,
    fontSize: 12,
    lineHeight: 16,
    color: '#6b6b6b',
    fontVariant: ['tabular-nums'],
  },
  emailColCustomers: {
    flex: 1.4,
    minWidth: 140,
    paddingRight: 16,
  },
  emailColRate: {
    flex: 1,
    minWidth: 96,
    textAlign: 'right',
  },
  emailCellRate: {
    fontFamily,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '500',
    color: '#1a1a1a',
    flex: 1,
    minWidth: 96,
    textAlign: 'right',
  },
  emailDrawerSubtitle: {
    fontFamily,
    fontSize: 13,
    lineHeight: 18,
    color: '#8a8a8a',
    marginTop: 8,
  },
  emailBreakdownHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e5e5',
    marginBottom: 4,
  },
  emailBreakdownHeaderText: {
    fontFamily,
    fontSize: 11,
    fontWeight: '600',
    color: '#9a9a9a',
    letterSpacing: 0.2,
  },
  emailBreakdownRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f2f2f2',
    gap: 12,
  },
  emailBreakdownColPerson: {
    flex: 1.1,
    minWidth: 0,
  },
  emailBreakdownColEmail: {
    flex: 1.4,
    minWidth: 0,
  },
  emailBreakdownColEmployee: {
    flex: 1,
    minWidth: 0,
  },
  emailBreakdownPerson: {
    fontFamily,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
    color: '#1a1a1a',
    flex: 1.1,
    minWidth: 0,
  },
  emailBreakdownEmail: {
    fontFamily,
    fontSize: 13,
    lineHeight: 18,
    color: '#4a4a4a',
    flex: 1.4,
    minWidth: 0,
  },
  emailBreakdownEmailMissing: {
    color: '#b0b0b0',
  },
  emailBreakdownEmployee: {
    fontFamily,
    fontSize: 13,
    lineHeight: 18,
    color: '#4a4a4a',
    flex: 1,
    minWidth: 0,
  },
  homeCellInlineMeta: {
    fontFamily,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '400',
    color: '#8a8a8a',
    fontVariant: ['tabular-nums'],
    flexShrink: 1,
  },
  homeStoreTableWrap: {
    alignSelf: 'stretch',
  },
  storeDrawerShell: {
    height: '100%',
    maxWidth: '100%',
    flexDirection: 'row',
    alignItems: 'stretch',
    overflow: 'visible',
  },
  storeDrawerPanel: {
    flexShrink: 0,
    minWidth: 0,
    minHeight: 0,
    overflow: 'hidden',
    flexDirection: 'column',
  },
  storeDrawerAppsRail: {
    width: STORE_DRAWER_RAIL_WIDTH,
    flexShrink: 0,
    justifyContent: 'flex-start',
    alignItems: 'center',
    paddingTop: 16,
    paddingBottom: 16,
    paddingHorizontal: 10,
    gap: 4,
    backgroundColor: 'transparent',
    overflow: 'visible',
  },
  storeDrawerRailSep: {
    width: 22,
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#d1d1d6',
    marginVertical: 4,
  },
  storeDrawerTabWrap: {
    width: 48,
    height: 48,
    position: 'relative',
    overflow: 'visible',
  },
  storeDrawerTab: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 48,
    height: 48,
    borderRadius: 12,
    ...Platform.select({
      web: {
        cursor: 'pointer',
      },
      default: {},
    }),
  },
  storeDrawerTabTip: {
    position: 'absolute',
    right: 56,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    zIndex: 2,
  },
  storeDrawerTabTipBubble: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 6,
    backgroundColor: '#1a1a1a',
    ...Platform.select({
      web: {
        boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
      },
      default: {
        elevation: 4,
      },
    }),
  },
  storeDrawerTabTipText: {
    fontFamily,
    fontSize: 12,
    lineHeight: 16,
    color: '#fff',
    ...Platform.select({
      web: {
        whiteSpace: 'nowrap',
      },
      default: {},
    }),
  },
  storeDrawerTabSelected: {
    backgroundColor: '#fff',
    ...Platform.select({
      web: {
        boxShadow: '0 1px 2px rgba(0,0,0,0.12)',
      },
      default: {
        elevation: 1,
      },
    }),
  },
  storeDrawerTabIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'transparent',
  },
  storeDrawerPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 64,
    paddingHorizontal: 24,
    gap: 12,
  },
  storeDrawerPlaceholderIcon: {
    width: 56,
    height: 56,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  storeDrawerPlaceholderTitle: {
    fontFamily,
    fontSize: 22,
    fontWeight: '600',
    color: '#1d1d1f',
    letterSpacing: -0.4,
  },
  storeDrawerPlaceholderBody: {
    fontFamily,
    fontSize: 15,
    lineHeight: 20,
    color: '#8e8e93',
    textAlign: 'center',
    letterSpacing: -0.2,
  },
  storeOverviewHero: {
    alignItems: 'center',
    paddingTop: 8,
    paddingBottom: 28,
    gap: 6,
  },
  storeOverviewName: {
    fontFamily,
    fontSize: 22,
    fontWeight: '600',
    color: '#1d1d1f',
    letterSpacing: -0.4,
    marginTop: 8,
  },
  storeOverviewPeriod: {
    fontFamily,
    fontSize: 15,
    color: '#8e8e93',
    letterSpacing: -0.2,
  },
  storeOverviewStatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 52,
    paddingLeft: 16,
    paddingRight: 14,
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e5ea',
  },
  storeOverviewStatPrimary: {
    fontWeight: '600',
    color: '#1d1d1f',
  },
  appleSheetTitle: {
    fontFamily,
    flex: 1,
    fontSize: 17,
    fontWeight: '600',
    color: '#1d1d1f',
    letterSpacing: -0.4,
  },
  appleCloseButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#e8e8ed',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  appleSheetHero: {
    paddingBottom: 24,
  },
  appleSheetCustomer: {
    fontFamily,
    fontSize: 28,
    fontWeight: '700',
    color: '#1d1d1f',
    letterSpacing: -0.6,
  },
  appleSheetMeta: {
    fontFamily,
    fontSize: 15,
    color: '#8e8e93',
    letterSpacing: -0.2,
    marginTop: 4,
  },
  appleSheetAmount: {
    fontFamily,
    fontSize: 34,
    fontWeight: '700',
    color: '#1d1d1f',
    letterSpacing: -0.8,
    fontVariant: ['tabular-nums'],
    marginTop: 8,
  },
  appleGroup: {
    backgroundColor: '#fff',
    borderRadius: 14,
    overflow: 'hidden',
  },
  appleDetailRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    minHeight: 44,
    paddingVertical: 11,
    paddingHorizontal: 16,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e5ea',
  },
  appleDetailLabel: {
    fontFamily,
    width: 108,
    flexShrink: 0,
    fontSize: 15,
    fontWeight: '400',
    color: '#8e8e93',
    letterSpacing: -0.2,
    paddingTop: 1,
  },
  appleDetailValueWrap: {
    flex: 1,
    minWidth: 0,
    alignItems: 'flex-end',
  },
  appleDetailValue: {
    fontFamily,
    fontSize: 15,
    fontWeight: '400',
    color: '#1d1d1f',
    letterSpacing: -0.2,
    textAlign: 'right',
  },
  appleDetailSub: {
    fontFamily,
    fontSize: 13,
    color: '#8e8e93',
    letterSpacing: -0.08,
    textAlign: 'right',
    marginTop: 2,
  },
  appleSheetSection: {
    marginTop: 24,
  },
  appleSheetSectionLabel: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: '#8e8e93',
    letterSpacing: -0.08,
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  appleTableHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 36,
    paddingHorizontal: 16,
    backgroundColor: '#fff',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e5ea',
  },
  appleTableHeaderText: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: '#8e8e93',
    letterSpacing: -0.08,
    textTransform: 'none',
  },
  appleTableRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    minHeight: 44,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e5ea',
    backgroundColor: '#fff',
  },
  appleTableItemName: {
    fontFamily,
    fontSize: 15,
    fontWeight: '400',
    color: '#1d1d1f',
    letterSpacing: -0.2,
    lineHeight: 20,
  },
  appleTableItemMeta: {
    fontFamily,
    fontSize: 13,
    color: '#8e8e93',
    letterSpacing: -0.08,
    marginTop: 2,
  },
  appleTableCell: {
    fontFamily,
    fontSize: 15,
    fontWeight: '400',
    color: '#1d1d1f',
    letterSpacing: -0.2,
    fontVariant: ['tabular-nums'],
  },
  appleTableMuted: {
    fontFamily,
    flex: 1,
    fontSize: 15,
    color: '#8e8e93',
    letterSpacing: -0.2,
    fontVariant: ['tabular-nums'],
  },
  appleTableTotalLabel: {
    fontFamily,
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: '#1d1d1f',
    letterSpacing: -0.2,
  },
  appleTableTotalValue: {
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: '#1d1d1f',
    letterSpacing: -0.2,
    fontVariant: ['tabular-nums'],
  },
  applePaymentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 52,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e5ea',
    backgroundColor: '#fff',
  },
  appleNotes: {
    fontFamily,
    fontSize: 15,
    lineHeight: 22,
    color: '#1d1d1f',
    letterSpacing: -0.2,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  txSheetTopBar: {
    paddingTop: 10,
    paddingBottom: 4,
    paddingHorizontal: 16,
  },
  txSheetBodyContent: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 28,
  },
  txSheetHero: {
    paddingBottom: 10,
    gap: 8,
  },
  txSheetHeroRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  txSheetHeroLeft: {
    flex: 1,
    minWidth: 0,
  },
  txSheetCustomer: {
    fontFamily,
    fontSize: 18,
    fontWeight: '700',
    color: '#1d1d1f',
    letterSpacing: -0.4,
  },
  txSheetMeta: {
    fontFamily,
    fontSize: 12,
    color: '#8e8e93',
    letterSpacing: -0.08,
    marginTop: 2,
  },
  txSheetAmount: {
    fontFamily,
    fontSize: 20,
    fontWeight: '700',
    color: '#1d1d1f',
    letterSpacing: -0.4,
    fontVariant: ['tabular-nums'],
  },
  txMetaGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    alignItems: 'flex-start',
  },
  txMetaCol: {
    flexGrow: 1,
    flexBasis: 280,
    minWidth: 260,
  },
  txStatusRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  txStatusChip: {
    backgroundColor: '#e8e8ed',
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  txStatusChipOk: {
    backgroundColor: '#E3F6EA',
  },
  txStatusChipWarn: {
    backgroundColor: '#FFF3D6',
  },
  txStatusChipMuted: {
    backgroundColor: '#EEEEF0',
  },
  txStatusChipText: {
    fontFamily,
    fontSize: 11,
    fontWeight: '600',
    color: '#1d1d1f',
    letterSpacing: -0.08,
  },
  txStatusChipTextOk: {
    color: '#1B7A3F',
  },
  txStatusChipTextWarn: {
    color: '#9A6B00',
  },
  txStatusChipTextMuted: {
    color: '#6B6B70',
  },
  txDetailRow: {
    minHeight: 32,
    paddingVertical: 6,
    paddingHorizontal: 12,
    gap: 8,
  },
  txDetailLabel: {
    width: 88,
    fontSize: 12,
    paddingTop: 1,
  },
  txDetailValue: {
    fontSize: 13,
  },
  txDetailSub: {
    fontSize: 11,
    marginTop: 1,
  },
  txSheetSection: {
    marginTop: 12,
  },
  txSheetSectionLabel: {
    fontFamily,
    fontSize: 12,
    fontWeight: '600',
    color: '#8e8e93',
    letterSpacing: -0.08,
    marginBottom: 6,
    paddingHorizontal: 4,
  },
  txTableHeaderText: {
    fontFamily,
    fontSize: 11,
    fontWeight: '600',
    color: '#8e8e93',
    letterSpacing: -0.08,
  },
  txLineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 40,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e5ea',
    backgroundColor: '#fff',
    gap: 8,
  },
  txLineThumbSlot: {
    width: 36,
    height: 36,
    flexShrink: 0,
  },
  txLineThumbPress: {
    width: 36,
    height: 36,
    flexShrink: 0,
    position: 'relative',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  txLineThumb: {
    width: 36,
    height: 36,
    borderRadius: 6,
    backgroundColor: '#ececf0',
  },
  txLineThumbBadge: {
    position: 'absolute',
    right: -3,
    bottom: -3,
    minWidth: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#1d1d1f',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  txLineThumbBadgeText: {
    fontFamily,
    fontSize: 9,
    fontWeight: '700',
    color: '#fff',
  },
  txLineItem: {
    flex: 1,
    minWidth: 0,
  },
  txLineName: {
    fontFamily,
    fontSize: 13,
    fontWeight: '500',
    color: '#1d1d1f',
    letterSpacing: -0.16,
    lineHeight: 17,
  },
  txLineMeta: {
    fontFamily,
    fontSize: 11,
    color: '#8e8e93',
    letterSpacing: -0.08,
    marginTop: 1,
  },
  txLineCell: {
    fontFamily,
    fontSize: 13,
    fontWeight: '500',
    color: '#1d1d1f',
    letterSpacing: -0.16,
    fontVariant: ['tabular-nums'],
    textAlign: 'right',
  },
  txColQty: {
    width: 52,
    textAlign: 'right',
  },
  txColDelivered: {
    width: 92,
    alignItems: 'flex-end',
  },
  txColAmount: {
    width: 96,
    textAlign: 'right',
  },
  txLineDeliveredQty: {
    fontSize: 12,
    width: '100%',
  },
  txLineDeliveredLabel: {
    fontFamily,
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: -0.04,
    marginTop: 1,
  },
  txLineOk: {
    color: '#1B7A3F',
  },
  txLineWarn: {
    color: '#9A6B00',
  },
  txLineMuted: {
    color: '#8e8e93',
  },
  txLineMutedFlex: {
    fontFamily,
    flex: 1,
    fontSize: 13,
    color: '#8e8e93',
    letterSpacing: -0.16,
  },
  txLineTotalLabel: {
    fontFamily,
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    color: '#1d1d1f',
    letterSpacing: -0.16,
  },
  txLineTotalValue: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: '#1d1d1f',
    letterSpacing: -0.16,
    fontVariant: ['tabular-nums'],
    textAlign: 'right',
  },
  txPaymentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 40,
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e5ea',
    backgroundColor: '#fff',
  },
  txNotes: {
    fontFamily,
    fontSize: 13,
    lineHeight: 18,
    color: '#1d1d1f',
    letterSpacing: -0.16,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  txImageViewerRoot: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  txImageViewerSheet: {
    width: '100%',
    maxWidth: 720,
    maxHeight: '90%',
    alignItems: 'stretch',
  },
  txImageViewerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 10,
  },
  txImageViewerTitle: {
    fontFamily,
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
  txImageViewerImage: {
    width: '100%',
    height: 480,
    maxHeight: '75%',
    borderRadius: 10,
    backgroundColor: '#111',
  },
  txImageViewerNav: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
    marginTop: 12,
  },
  txImageViewerNavBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },

  breadcrumb: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    alignSelf: 'stretch',
  },
  breadcrumbLink: {
    paddingVertical: 2,
  },
  breadcrumbLinkText: {
    fontFamily,
    fontSize: 20,
    fontWeight: '600',
    color: '#6b6b6b',
  },
  breadcrumbSep: {
    fontFamily,
    fontSize: 18,
    color: '#b0b0b0',
  },
  breadcrumbCurrent: {
    fontFamily,
    fontSize: 20,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  toolsScreen: {
    flex: 1,
    minHeight: 0,
    alignItems: 'stretch',
    width: '100%',
    ...Platform.select({
      web: { overflow: 'hidden' },
      default: {},
    }),
  },
  toolsToolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 4,
    marginBottom: 8,
    width: '100%',
    maxWidth: APP_GRID_MAX_WIDTH,
    alignSelf: 'center',
  },
  toolsToolbarOverlay: {
    marginTop: 0,
    marginBottom: 0,
  },
  toolsToolbarBlur: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 3,
    overflow: 'hidden',
    paddingTop: 32,
    paddingHorizontal: 32,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(0,0,0,0.06)',
  },
  toolsToolbarBlurMobile: {
    paddingTop: 16,
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  toolsToolbarMobile: {
    maxWidth: '100%',
    marginTop: 0,
  },
  appsLibraryScrollContent: {
    paddingHorizontal: 32,
  },
  appsLibraryScrollContentMobile: {
    paddingHorizontal: 16,
  },
  toolsSearch: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 0,
    borderRadius: 12,
    paddingHorizontal: 12,
    backgroundColor: '#e8e8ed',
    minHeight: 42,
  },
  toolsSearchMobile: {
    minHeight: 40,
  },
  appsViewToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 0,
    backgroundColor: '#e8e8ed',
    borderRadius: 10,
    padding: 2,
    gap: 0,
  },
  appsViewToggleButton: {
    width: 38,
    height: 38,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  appsViewToggleButtonActive: {
    backgroundColor: '#fff',
    ...Platform.select({
      web: {
        boxShadow: '0 1px 2px rgba(0,0,0,0.12)',
      },
      default: {
        elevation: 1,
      },
    }),
  },
  toolsScroll: {
    flex: 1,
    minHeight: 0,
    width: '100%',
    ...Platform.select({
      web: {
        overflowY: 'auto',
        overflowX: 'hidden',
        height: 0,
      },
      default: {},
    }),
  },
  toolsScrollContent: {
    paddingBottom: 40,
    paddingTop: 16,
  },
  toolsSectionMobile: {
    maxWidth: '100%',
  },
  toolsSearchIcon: {
    marginRight: 8,
  },
  toolsSearchInput: {
    flex: 1,
    fontFamily,
    fontSize: 16,
    color: '#1d1d1f',
    paddingVertical: 10,
    outlineStyle: 'none',
  },
  toolsEmpty: {
    fontFamily,
    fontSize: 15,
    color: '#8e8e93',
    marginTop: 48,
    maxWidth: APP_GRID_MAX_WIDTH,
    width: '100%',
    alignSelf: 'center',
    textAlign: 'center',
  },
  toolsSection: {
    marginTop: 12,
    width: '100%',
    maxWidth: APP_GRID_MAX_WIDTH,
    alignSelf: 'center',
  },
  toolsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    width: '100%',
    alignSelf: 'center',
    justifyContent: 'flex-start',
  },
  toolCardWrap: {
    position: 'relative',
    alignItems: 'center',
    ...Platform.select({
      web: {
        boxSizing: 'border-box',
      },
      default: {},
    }),
  },
  toolCard: {
    width: '100%',
    alignItems: 'center',
    gap: 7,
    ...Platform.select({
      web: {
        cursor: 'pointer',
      },
      default: {},
    }),
  },
  toolIconStack: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  toolIconTile: {
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      web: {
        boxShadow: '0 1px 1px rgba(0,0,0,0.06), 0 8px 18px rgba(0,0,0,0.12)',
      },
      default: {
        elevation: 4,
      },
    }),
  },
  toolCardLabel: {
    fontFamily,
    fontSize: 13,
    fontWeight: '500',
    color: '#1d1d1f',
    textAlign: 'center',
    lineHeight: 16,
    letterSpacing: -0.08,
    width: '100%',
    paddingHorizontal: 2,
  },
  pinButton: {
    position: 'absolute',
    top: -5,
    right: -6,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#d0d0d0',
    opacity: 0,
    zIndex: 2,
    ...Platform.select({
      web: {
        cursor: 'pointer',
        transitionProperty: 'opacity',
        transitionDuration: '120ms',
      },
      default: {
        opacity: 1,
      },
    }),
  },
  pinButtonVisible: {
    opacity: 1,
  },
  pinButtonActive: {
    backgroundColor: '#f2f2f7',
    borderColor: '#c7c7cc',
    opacity: 1,
  },
  toolsList: {
    backgroundColor: '#f2f2f7',
    borderRadius: 14,
    overflow: 'hidden',
  },
  toolListRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 56,
    paddingRight: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e5ea',
  },
  toolListRowHovered: {
    backgroundColor: '#e8e8ed',
  },
  toolListRowLast: {
    borderBottomWidth: 0,
  },
  toolListMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 0,
    paddingVertical: 8,
    paddingLeft: 12,
    paddingRight: 8,
    gap: 12,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  toolListIcon: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  toolListLabel: {
    fontFamily,
    flex: 1,
    fontSize: 17,
    fontWeight: '400',
    color: '#1d1d1f',
    letterSpacing: -0.2,
  },
  toolListPin: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  toolPageBody: {
    fontFamily,
    fontSize: 14,
    color: '#6b6b6b',
    marginTop: 24,
  },
  transactionsBody: {
    flex: 1,
    minHeight: 0,
    alignSelf: 'stretch',
    width: '100%',
    marginTop: 8,
  },
  txToolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 4,
    marginBottom: 8,
    width: '100%',
  },
  txControls: {
    maxWidth: '100%',
    alignSelf: 'stretch',
    marginTop: 0,
  },
  txMetaRow: {
    maxWidth: '100%',
    alignSelf: 'stretch',
    marginTop: 10,
  },
  txListWrap: {
    flex: 1,
    minHeight: 0,
    backgroundColor: '#f2f2f7',
    borderRadius: 14,
    overflow: 'hidden',
    marginTop: 8,
    position: 'relative',
  },
  txDrawerTable: {
    flex: 0,
    minHeight: undefined,
    marginTop: 0,
  },
  txListContent: {
    paddingBottom: 24,
  },
  txTableHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 36,
    paddingHorizontal: 16,
    backgroundColor: '#ebebf0',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#d1d1d6',
  },
  txTableHeaderCell: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: 36,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  txTableHeaderCellHover: {
    opacity: 0.72,
  },
  txTableHeaderLabel: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: '#8e8e93',
    letterSpacing: -0.08,
    flexShrink: 1,
  },
  txTableHeaderLabelActive: {
    color: '#1d1d1f',
  },
  txTableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: TX_ROW_HEIGHT,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e5ea',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  txListRowSelected: {
    backgroundColor: '#e8e8ed',
  },
  txTableCell: {
    fontFamily,
    fontSize: 15,
    fontWeight: '400',
    color: '#1d1d1f',
    letterSpacing: -0.2,
  },
  txTableCellPrimary: {
    fontWeight: '500',
  },
  txTableCellSecondary: {
    color: '#6e6e73',
  },
  txTableRef: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minWidth: 0,
  },
  txTableKind: {
    fontFamily,
    fontSize: 12,
    fontWeight: '600',
    color: '#2F6FED',
    letterSpacing: -0.08,
    width: 22,
    flexShrink: 0,
  },
  txTableKindBuy: {
    color: '#C47A12',
  },
  txTableAmount: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 6,
  },
  txTableAmountText: {
    fontFamily,
    fontSize: 15,
    fontWeight: '400',
    color: '#1d1d1f',
    letterSpacing: -0.2,
    fontVariant: ['tabular-nums'],
    textAlign: 'right',
  },
  transactionsToolbar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 12,
    marginBottom: 10,
  },
  transactionsToolbarMobile: {
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: 10,
  },
  txSearch: {
    flexDirection: 'row',
    alignItems: 'center',
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 240,
    minWidth: 200,
    maxWidth: 420,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e0e0e0',
    borderRadius: 10,
    paddingHorizontal: 12,
    backgroundColor: '#f7f7f7',
    minHeight: 40,
  },
  txSearchMobile: {
    maxWidth: '100%',
    minWidth: 0,
    flexBasis: 'auto',
    width: '100%',
  },
  dateFiltersMobile: {
    width: '100%',
  },
  mobileTxCard: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ececec',
    backgroundColor: '#fff',
  },
  mobileTxCardSelected: {
    backgroundColor: '#f0f0f0',
  },
  mobileTxCardPressed: {
    backgroundColor: '#f5f5f5',
  },
  mobileTxCardTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 4,
  },
  mobileTxCustomer: {
    fontFamily,
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  mobileTxAmountWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  mobileTxAmount: {
    fontFamily,
    fontSize: 14,
    fontWeight: '600',
    color: '#1a1a1a',
    fontVariant: ['tabular-nums'],
  },
  mobileTxMeta: {
    fontFamily,
    fontSize: 12,
    color: '#6b6b6b',
    marginTop: 2,
  },
  mobileTxEmployee: {
    fontFamily,
    fontSize: 12,
    color: '#8a8a8a',
    marginTop: 4,
  },
  tableListContentMobile: {
    paddingBottom: 24,
  },
  txSearchIcon: {
    marginRight: 8,
  },
  txSearchInput: {
    flex: 1,
    fontFamily,
    fontSize: 13,
    color: '#1a1a1a',
    paddingVertical: 10,
    outlineStyle: 'none',
  },
  dateFilters: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  dateModeGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f3f3f3',
    borderRadius: 10,
    padding: 3,
    gap: 2,
  },
  dateModeChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    minHeight: 34,
    justifyContent: 'center',
    ...Platform.select({
      web: {
        cursor: 'pointer',
      },
      default: {},
    }),
  },
  dateModeChipActive: {
    backgroundColor: '#fff',
    ...Platform.select({
      web: {
        boxShadow: '0 1px 2px rgba(0,0,0,0.08)',
      },
      default: {
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: '#e0e0e0',
      },
    }),
  },
  dateModeChipText: {
    fontFamily,
    fontSize: 13,
    fontWeight: '500',
    color: '#6b6b6b',
  },
  dateModeChipTextActive: {
    color: '#1a1a1a',
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
    ...Platform.select({
      web: {
        cursor: 'pointer',
      },
      default: {},
    }),
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
  dateRangeSep: {
    fontFamily,
    fontSize: 14,
    color: '#c0c0c0',
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
    fontSize: 15,
    fontWeight: '600',
    color: '#2F6FED',
  },
  transactionsMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
    minHeight: 18,
  },
  transactionsMeta: {
    fontFamily,
    fontSize: 12,
    color: '#8a8a8a',
  },
  tableWrap: {
    flex: 1,
    minHeight: 0,
    backgroundColor: '#fff',
    position: 'relative',
    overflow: 'visible',
  },
  tableList: {
    flex: 1,
    overflow: 'hidden',
  },
  tableListContent: {
    paddingBottom: 16,
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    height: TX_ROW_HEIGHT,
    paddingHorizontal: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f2f2f2',
    backgroundColor: '#fff',
    ...Platform.select({
      web: {
        cursor: 'pointer',
        transitionProperty: 'none',
      },
      default: {},
    }),
  },
  tableRowHover: {
    backgroundColor: '#ececec',
  },
  tableRowSelected: {
    backgroundColor: '#e4e4e4',
  },
  drawerRoot: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    overflow: 'visible',
  },
  drawerBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.28)',
  },
  drawerPanel: {
    height: '100%',
    backgroundColor: '#fff',
    ...Platform.select({
      web: {
        boxShadow: '-12px 0 32px rgba(0,0,0,0.18)',
      },
      default: {
        elevation: 12,
      },
    }),
  },
  appleSheetPanel: {
    backgroundColor: '#f2f2f7',
  },
  invoiceTopBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 8,
    gap: 12,
  },
  invoiceTopBarMobile: {
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 54 : 18,
    paddingBottom: 10,
  },
  invoiceHeaderRowMobile: {
    flexDirection: 'column',
    gap: 12,
  },
  invoiceInfoGridMobile: {
    flexDirection: 'column',
  },
  drawerBodyContentMobile: {
    paddingHorizontal: 16,
    paddingBottom: 32,
  },
  drawerBodyContentInventoryMobile: {
    paddingHorizontal: 12,
  },
  invoiceDocLabel: {
    fontFamily,
    fontSize: 11,
    fontWeight: '600',
    color: '#8a8a8a',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  drawerClose: {
    padding: 2,
  },
  drawerBody: {
    flex: 1,
    minHeight: 0,
  },
  drawerBodyFill: {
    minHeight: 0,
  },
  drawerBodyContent: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 48,
  },
  drawerBodyContentInventory: {
    flex: 1,
    minHeight: 0,
    width: '100%',
    maxWidth: '100%',
    paddingHorizontal: 20,
    paddingBottom: 24,
  },
  drawerLoading: {
    paddingVertical: 36,
    alignItems: 'center',
  },
  invoiceHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 24,
    paddingTop: 8,
    paddingBottom: 28,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e5e5',
    marginBottom: 28,
  },
  invoiceHeaderLeft: {
    flex: 1,
    minWidth: 0,
  },
  invoiceHeaderRight: {
    alignItems: 'flex-end',
  },
  invoiceNumber: {
    fontFamily,
    fontSize: 24,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  invoiceTotalLabelTop: {
    fontFamily,
    fontSize: 11,
    fontWeight: '600',
    color: '#8a8a8a',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    marginBottom: 6,
  },
  invoiceTotalHero: {
    fontFamily,
    fontSize: 28,
    fontWeight: '600',
    color: '#1a1a1a',
    fontVariant: ['tabular-nums'],
  },
  invoiceInfoGrid: {
    flexDirection: 'row',
    gap: 20,
    marginBottom: 32,
  },
  invoiceInfoCard: {
    flex: 1,
    minWidth: 0,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e5e5',
    borderRadius: 8,
    padding: 16,
    backgroundColor: '#fafafa',
  },
  invoiceSection: {
    marginBottom: 32,
  },
  invoiceSectionLabel: {
    fontFamily,
    fontSize: 11,
    fontWeight: '600',
    color: '#8a8a8a',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    marginBottom: 12,
  },
  invoicePartyName: {
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: '#1a1a1a',
    marginBottom: 4,
  },
  invoicePartyDetail: {
    fontFamily,
    fontSize: 13,
    color: '#6b6b6b',
    marginTop: 4,
    lineHeight: 18,
  },
  invoiceDetailList: {
    gap: 12,
  },
  invoiceDetailRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  invoiceDetailKey: {
    fontFamily,
    fontSize: 12,
    fontWeight: '600',
    color: '#8a8a8a',
    width: 72,
    paddingTop: 1,
  },
  invoiceDetailValWrap: {
    flex: 1,
    minWidth: 0,
  },
  invoiceDetailVal: {
    fontFamily,
    fontSize: 13,
    color: '#1a1a1a',
    flex: 1,
    lineHeight: 18,
  },
  invoiceDetailSub: {
    fontFamily,
    fontSize: 12,
    color: '#6b6b6b',
    marginTop: 3,
    lineHeight: 16,
  },
  invoiceStatusRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  },
  invoiceStatusChip: {
    backgroundColor: '#e8e8ed',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  invoiceStatusText: {
    fontFamily,
    fontSize: 13,
    color: '#1d1d1f',
    fontWeight: '500',
    letterSpacing: -0.08,
  },
  invoiceTableHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: 10,
    marginBottom: 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#1a1a1a',
  },
  invoiceTableHeaderText: {
    fontFamily,
    fontSize: 11,
    fontWeight: '600',
    color: '#8a8a8a',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  invoiceTableRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#eeeeee',
  },
  invoiceColItem: {
    flex: 1,
    minWidth: 0,
    paddingRight: 16,
  },
  invoiceColQty: {
    width: 64,
    fontFamily,
    fontSize: 13,
    color: '#1a1a1a',
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
    paddingTop: 1,
  },
  invoiceColAmount: {
    width: 120,
    fontFamily,
    fontSize: 13,
    color: '#1a1a1a',
    textAlign: 'right',
    fontWeight: '500',
    fontVariant: ['tabular-nums'],
    paddingTop: 1,
  },
  invoiceItemName: {
    fontFamily,
    fontSize: 13,
    color: '#1a1a1a',
    fontWeight: '500',
    lineHeight: 18,
  },
  invoiceItemSku: {
    fontFamily,
    fontSize: 12,
    color: '#8a8a8a',
    marginTop: 4,
    lineHeight: 16,
  },
  invoiceEmptyLine: {
    fontFamily,
    fontSize: 13,
    color: '#8a8a8a',
    paddingVertical: 20,
  },
  invoiceTotals: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#1a1a1a',
    gap: 8,
  },
  invoiceTotalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  invoiceTotalLabel: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  invoiceTotalValue: {
    fontFamily,
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a1a',
    fontVariant: ['tabular-nums'],
  },
  invoiceTotalMuted: {
    fontFamily,
    fontSize: 12,
    color: '#6b6b6b',
  },
  invoicePaymentRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#eeeeee',
  },
  invoiceNotesSection: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e5e5e5',
    paddingTop: 24,
  },
  invoiceNotes: {
    fontFamily,
    fontSize: 13,
    color: '#1a1a1a',
    lineHeight: 20,
  },
  tableHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    height: TX_ROW_HEIGHT,
    paddingHorizontal: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e8e8e8',
    zIndex: 2,
  },
  headerCell: {
    flexDirection: 'row',
    alignItems: 'center',
    height: '100%',
    gap: 4,
    ...Platform.select({
      web: {
        cursor: 'pointer',
      },
      default: {},
    }),
  },
  headerFilterIcon: {
    marginTop: 1,
    flexShrink: 0,
  },
  tableHeaderCell: {
    fontFamily,
    fontSize: 11,
    fontWeight: '600',
    color: '#9a9a9a',
    letterSpacing: 0.2,
    flexShrink: 1,
  },
  clearFiltersText: {
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: '#1d1d1f',
    letterSpacing: -0.2,
  },
  filterModalRoot: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  filterModalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.28)',
  },
  filterMenu: {
    width: '100%',
    maxWidth: 340,
    maxHeight: '80%',
    backgroundColor: '#fff',
    borderRadius: 14,
    overflow: 'hidden',
    ...Platform.select({
      web: {
        boxShadow: '0 12px 40px rgba(0,0,0,0.18)',
      },
      default: {
        elevation: 10,
      },
    }),
  },
  filterMenuHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  filterMenuTitle: {
    fontFamily,
    fontSize: 17,
    fontWeight: '600',
    color: '#1d1d1f',
    letterSpacing: -0.4,
  },
  filterField: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginBottom: 10,
    borderRadius: 10,
    paddingHorizontal: 12,
    backgroundColor: '#e8e8ed',
    minHeight: 36,
  },
  filterFieldLabel: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: '#8e8e93',
    width: 56,
  },
  filterFieldInput: {
    flex: 1,
    fontFamily,
    fontSize: 15,
    color: '#1d1d1f',
    paddingVertical: 8,
    paddingHorizontal: 0,
    outlineStyle: 'none',
  },
  filterActions: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 8,
    gap: 6,
  },
  filterActionText: {
    fontFamily,
    fontSize: 15,
    fontWeight: '500',
    color: '#1d1d1f',
  },
  filterActionDisabled: {
    color: '#c0c0c0',
  },
  filterActionSep: {
    fontFamily,
    fontSize: 12,
    color: '#d0d0d0',
  },
  filterCount: {
    fontFamily,
    fontSize: 11,
    color: '#8a8a8a',
    marginLeft: 'auto',
  },
  filterList: {
    height: 240,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e5e5e5',
  },
  filterOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    minHeight: 44,
    ...Platform.select({
      web: {
        cursor: 'pointer',
      },
      default: {},
    }),
  },
  filterOptionText: {
    fontFamily,
    fontSize: 15,
    color: '#1d1d1f',
    letterSpacing: -0.2,
    flex: 1,
  },
  filterEmpty: {
    fontFamily,
    fontSize: 13,
    color: '#8a8a8a',
    textAlign: 'center',
    paddingVertical: 20,
  },
  filterDoneButton: {
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 16,
    backgroundColor: '#1d1d1f',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    alignItems: 'center',
    minHeight: 40,
    justifyContent: 'center',
  },
  filterDoneButtonText: {
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
    letterSpacing: -0.2,
  },
  tableCell: {
    fontFamily,
    fontSize: 13,
    color: '#1a1a1a',
    lineHeight: 16,
  },
  cellStore: {
    fontFamily,
    fontSize: 13,
    lineHeight: 16,
    color: '#1a1a1a',
    flex: 1.1,
    minWidth: 72,
    paddingRight: 12,
  },
  cellDate: {
    fontFamily,
    fontSize: 13,
    lineHeight: 16,
    color: '#5a5a5a',
    flex: 1.2,
    minWidth: 96,
    paddingRight: 12,
  },
  cellTime: {
    fontFamily,
    fontSize: 13,
    lineHeight: 16,
    color: '#5a5a5a',
    flex: 0.75,
    minWidth: 64,
    paddingRight: 12,
  },
  cellRef: {
    fontFamily,
    fontSize: 13,
    lineHeight: 16,
    color: '#4a4a4a',
    flex: 1.05,
    minWidth: 84,
    paddingRight: 12,
    fontVariant: ['tabular-nums'],
  },
  cellCustomer: {
    fontFamily,
    fontSize: 13,
    lineHeight: 16,
    color: '#1a1a1a',
    flex: 2.4,
    minWidth: 120,
    paddingRight: 12,
  },
  cellPayment: {
    fontFamily,
    fontSize: 13,
    lineHeight: 16,
    color: '#4a4a4a',
    flex: 1.4,
    minWidth: 110,
    paddingRight: 12,
  },
  cellAmount: {
    flex: 1.2,
    minWidth: 96,
    paddingRight: 12,
    justifyContent: 'center',
  },
  amountCellInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    minWidth: 0,
  },
  amountCellText: {
    fontFamily,
    fontSize: 13,
    lineHeight: 16,
    color: '#1a1a1a',
    fontWeight: '500',
    fontVariant: ['tabular-nums'],
    flexShrink: 1,
  },
  amountCellFintrac: {
    color: '#8a1c1c',
    fontWeight: '600',
  },
  fintracDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#b42318',
    flexShrink: 0,
  },
  cellEmployee: {
    flex: 1.5,
    minWidth: 100,
    justifyContent: 'center',
  },
  employeeCellText: {
    fontFamily,
    fontSize: 13,
    lineHeight: 16,
    color: '#1a1a1a',
  },
  filterPreset: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 10,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#fff7f7',
    ...Platform.select({
      web: {
        cursor: 'pointer',
      },
      default: {},
    }),
  },
  filterPresetTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  filterPresetTitle: {
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: '#8a1c1c',
    letterSpacing: -0.2,
  },
  filterPresetSub: {
    fontFamily,
    fontSize: 13,
    color: '#a05a5a',
    marginTop: 1,
  },
  fintracFilterBadge: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: '#8a1c1c',
    backgroundColor: '#fff7f7',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    overflow: 'hidden',
  },
  colStore: {
    flex: 1.15,
    minWidth: 86,
    paddingRight: 16,
  },
  colDate: {
    flex: 1.05,
    minWidth: 88,
    paddingRight: 16,
  },
  colTime: {
    flex: 0.7,
    minWidth: 58,
    paddingRight: 16,
  },
  colRef: {
    flex: 1.25,
    minWidth: 108,
    paddingRight: 16,
  },
  colCustomer: {
    flex: 2.5,
    minWidth: 140,
    paddingRight: 16,
  },
  colPayment: {
    flex: 1.35,
    minWidth: 108,
    paddingRight: 16,
  },
  colAmount: {
    flex: 1.1,
    minWidth: 92,
    paddingRight: 16,
    justifyContent: 'flex-end',
    textAlign: 'right',
  },
  colEmployee: {
    flex: 1.45,
    minWidth: 104,
  },
  tableEmpty: {
    paddingVertical: 48,
    alignItems: 'center',
  },
  tableEmptyText: {
    fontFamily,
    fontSize: 13,
    color: '#8a8a8a',
  },
  loginForm: {
    flex: 1,
    width: '100%',
    maxWidth: 360,
    alignSelf: 'center',
    justifyContent: 'center',
  },
  loginSubtitle: {
    fontFamily,
    fontSize: 13,
    color: '#6b6b6b',
    marginTop: 6,
    marginBottom: 24,
  },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#d0d0d0',
    borderRadius: 6,
    paddingHorizontal: 12,
    marginBottom: 14,
    backgroundColor: '#fff',
  },
  fieldLabel: {
    fontFamily,
    fontSize: 12,
    fontWeight: '600',
    color: '#1a1a1a',
    width: 80,
  },
  input: {
    flex: 1,
    fontFamily,
    fontSize: 13,
    color: '#1a1a1a',
    paddingVertical: 10,
    paddingHorizontal: 0,
    outlineStyle: 'none',
  },
  errorText: {
    fontFamily,
    fontSize: 12,
    color: '#b42318',
    marginBottom: 12,
  },
  loginButton: {
    marginTop: 4,
    backgroundColor: '#1a1a1a',
    borderRadius: 6,
    paddingVertical: 10,
    alignItems: 'center',
    minHeight: 40,
    justifyContent: 'center',
  },
  loginButtonDisabled: {
    opacity: 0.7,
  },
  loginButtonText: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: '#fff',
  },
  profileHero: {
    alignItems: 'center',
    paddingTop: 12,
    paddingBottom: 28,
  },
  profileAvatarButton: {
    marginBottom: 14,
    position: 'relative',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  profileAvatar: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#e8e8ed',
  },
  profileAvatarCamera: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#1d1d1f',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#fff',
  },
  profilePhotoAction: {
    fontFamily,
    fontSize: 14,
    fontWeight: '500',
    color: '#2F6FED',
    marginTop: 8,
    letterSpacing: -0.2,
  },
  profileName: {
    fontFamily,
    fontSize: 28,
    fontWeight: '700',
    color: '#1d1d1f',
    letterSpacing: -0.6,
    textAlign: 'center',
  },
  profileEmail: {
    fontFamily,
    fontSize: 15,
    color: '#8e8e93',
    letterSpacing: -0.2,
    marginTop: 4,
    textAlign: 'center',
  },
  profileGroupFooter: {
    fontFamily,
    fontSize: 13,
    color: '#8e8e93',
    letterSpacing: -0.08,
    lineHeight: 18,
    marginTop: 8,
    paddingHorizontal: 4,
  },
  profileError: {
    marginTop: 16,
    fontSize: 13,
  },
  profileLinkedBlock: {
    marginTop: 24,
  },
  profileLogoutGroup: {
    marginTop: 28,
  },
  profileLogoutRow: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  profileLogoutText: {
    fontFamily,
    fontSize: 17,
    fontWeight: '400',
    color: '#ff3b30',
    letterSpacing: -0.2,
  },
});
