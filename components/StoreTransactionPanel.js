import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useDisplayCurrency } from '../lib/displayCurrency';
import { CANVAS, MOBILE_FILTER_INSET, useIsMobile } from '../lib/mobileUi';
import { mobileTabBarReserve } from '../lib/mobileTabBar';
import {
  collectItemImageUrls,
  formatAmount,
  formatUnitCost,
  lineItemMoney,
} from '../lib/transactions';

const fontFamily = Platform.select({
  ios: 'Sohne',
  android: 'Sohne',
  default: 'Sohne',
});

const LABEL = '#1d1d1f';
const SECONDARY = '#8e8e93';
const MUTED = '#6e6e73';
const HAIRLINE = '#e5e5ea';
const ROW_RULE = '#ececef';
const BUY = { accent: '#1F8A4E', tint: '#EAF6EE', line: '#d7eadc' };
const SELL = { accent: '#2F6FED', tint: '#EEF3FD', line: '#d5e2f8' };

function themeFor(isPurchase) {
  return isPurchase ? BUY : SELL;
}

export function documentCrumb(summary) {
  const reference = String(summary?.reference || '').trim();
  if (/\b(SO|PO)\b/i.test(reference)) return reference;
  const kind = summary?.type === 'purchase' ? 'PO' : 'SO';
  if (!reference) return kind;
  return `${kind} ${reference}`;
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
    return product?.type === 'scrap' ? `Scrap ${product.metal.name}` : product.metal.name;
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

  return { key, label, ordered, delivered, deliveredLines, lineCount: lines.length };
}

function toneStyle(key) {
  if (key === 'allocated' || key === 'delivered') return 'ok';
  if (key === 'partial') return 'warn';
  if (key === 'unallocated' || key === 'undelivered') return 'muted';
  return 'neutral';
}

function inferLineType(item) {
  const product = item?.product;
  if (product?.type === 'scrap') return 'Scrap';
  const name = lineItemName(item);
  if (/watch|rolex|omega|patek|tudor|breitling|cartier|hublot/i.test(name)) return 'Watch';
  if (/diamond|gemstone|gia/i.test(name)) return 'Diamond';
  if (/numismatic|paper money|bank note|collector coin/i.test(name)) return 'Numismatic';
  if (product?.type === 'bullion' || /bullion|maple|eagle|krug|wafer|\bbar\b|\boz\b/i.test(name)) {
    return 'Bullion';
  }
  return product?.metal?.name || '';
}

function typeTone(type) {
  if (type === 'Bullion') return 'bullion';
  if (type === 'Watch') return 'watch';
  if (type === 'Diamond') return 'diamond';
  if (type === 'Numismatic') return 'numismatic';
  if (type === 'Scrap') return 'scrap';
  return 'neutral';
}

function LineThumb({ urls, name }) {
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [urls[0]]);

  if (!urls.length || failed) {
    return <View style={styles.thumbSlot} />;
  }

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        style={styles.thumbPress}
        accessibilityRole="button"
        accessibilityLabel={`View photo of ${name}`}
      >
        <Image
          source={{ uri: urls[0] }}
          style={styles.thumb}
          resizeMode="cover"
          onError={() => setFailed(true)}
        />
        {urls.length > 1 ? (
          <View style={styles.thumbBadge}>
            <Text style={styles.thumbBadgeText}>{urls.length}</Text>
          </View>
        ) : null}
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View style={styles.viewerRoot}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setOpen(false)} />
          <Image source={{ uri: urls[0] }} style={styles.viewerImage} resizeMode="contain" />
        </View>
      </Modal>
    </>
  );
}

function FieldRow({ label, value, sub, tone = 'neutral', last = false }) {
  return (
    <View style={[styles.fieldRow, last && styles.fieldRowLast]}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.fieldValueWrap}>
        <Text
          style={[
            styles.fieldValue,
            tone === 'ok' && styles.valueOk,
            tone === 'warn' && styles.valueWarn,
            tone === 'muted' && styles.valueMuted,
          ]}
          numberOfLines={2}
        >
          {value || '—'}
        </Text>
        {sub ? (
          <Text style={styles.fieldSub} numberOfLines={2}>
            {sub}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function TicketCard({ children, style }) {
  return <View style={[styles.ticketCard, style]}>{children}</View>;
}

export default function StoreTransactionPanel({
  storeName = '',
  periodLabel = '',
  summary,
  detail,
  loading = false,
  error = '',
  onClose,
  topInset = 0,
}) {
  const isMobile = useIsMobile();
  const { width } = useWindowDimensions();
  const compact = isMobile || width < 980;
  const { money } = useDisplayCurrency();
  const formatMoney = typeof money === 'function' ? money : formatAmount;

  if (!summary) return null;

  const client = detail?.client;
  const clientName = client
    ? [client.first_name, client.last_name].filter(Boolean).join(' ').trim()
    : summary.customerName;
  const location = detail?.location;
  const locationName = location?.name || summary.storeName || storeName;
  const locationLine = location
    ? [location.address_1, location.city, location.state, location.zip].filter(Boolean).join(', ')
    : null;
  const items = Array.isArray(detail?.items) ? detail.items : [];
  const payments = Array.isArray(detail?.payments) ? detail.payments : [];
  const totalAmount = detail?.total_amount ?? summary.amount;
  const isPurchase = summary.type === 'purchase';
  const docKind = isPurchase ? 'PO' : 'SO';
  const docLabel = isPurchase ? 'Purchase order' : 'Sales invoice';
  const crumb = documentCrumb(summary);
  const allocation = detail ? allocationState(detail) : null;
  const delivery = detail ? documentDeliveryState(detail, items) : null;
  const paymentStatus = String(detail?.payment_status || '').trim();
  const paymentLabel =
    summary.paymentBreakdownLabel || summary.paymentMethodLabel || paymentStatus || '—';
  const occurred = [summary.dateLabel, summary.timeLabel].filter(Boolean).join(' · ');
  const theme = themeFor(isPurchase);
  const charges = detail?.total_charges;
  const allocationSub =
    allocation?.allocated != null && allocation?.total != null
      ? `${formatMoney(allocation.allocated)} of ${formatMoney(allocation.total)}`
      : null;
  const deliverySub = delivery?.lineCount
    ? `${formatLineQty(delivery.delivered)} of ${formatLineQty(delivery.ordered)}`
    : null;

  const itemsBody = loading ? (
    <View style={styles.loading}>
      <ActivityIndicator color={LABEL} />
    </View>
  ) : error ? (
    <Text style={styles.empty}>{error}</Text>
  ) : items.length === 0 ? (
    <Text style={styles.empty}>No line items</Text>
  ) : (
    <>
      {isMobile ? null : (
        <View style={styles.itemsHead}>
          <View style={styles.thumbSlot} />
          <Text style={[styles.itemsHeadLabel, styles.colItem]}>Item</Text>
          <Text style={[styles.itemsHeadLabel, styles.colType]}>Type</Text>
          <Text style={[styles.itemsHeadLabel, styles.colQty]}>Qty</Text>
          <Text style={[styles.itemsHeadLabel, styles.colDelivered]}>Delivered</Text>
          <Text style={[styles.itemsHeadLabel, styles.colUnit]}>Unit</Text>
          <Text style={[styles.itemsHeadLabel, styles.colAmount, styles.colRight]}>Amount</Text>
        </View>
      )}
      {items.map((item, index) => {
        const name = lineItemName(item);
        const meta = lineItemMeta(item);
        const images = collectItemImageUrls(item);
        const moneyLine = lineItemMoney(item);
        const unitType = item?.unit_type || (moneyLine.grossQuantity ? 'g' : '');
        const lineDelivery = lineDeliveryState(item);
        const lineType = inferLineType(item);
        const last = index === items.length - 1;
        if (isMobile) {
          return (
            <View key={item.id || `${name}-${index}`} style={[styles.compactRow, last && styles.rowLast]}>
              <View style={styles.compactTop}>
                <LineThumb urls={images} name={name} />
                <View style={styles.compactNameCell}>
                  <Text style={styles.itemName} numberOfLines={2}>
                    {name}
                  </Text>
                  {meta ? (
                    <Text style={styles.itemMeta} numberOfLines={1}>
                      {meta}
                    </Text>
                  ) : null}
                </View>
                {lineType ? (
                  <Text style={[styles.typeBadge, styles.typeBadgeCompact, styles[`type_${typeTone(lineType)}`]]}>
                    {lineType}
                  </Text>
                ) : null}
              </View>
              <View style={styles.compactBottom}>
                <View style={styles.compactField}>
                  <Text style={styles.compactFieldLabel}>Qty</Text>
                  <Text style={styles.compactFieldValue}>{formatLineQty(lineDelivery.ordered)}</Text>
                </View>
                <View style={styles.compactField}>
                  <Text style={styles.compactFieldLabel}>Delivered</Text>
                  <Text
                    style={[
                      styles.compactFieldValue,
                      lineDelivery.key === 'delivered' && styles.valueOk,
                      lineDelivery.key === 'partial' && styles.valueWarn,
                      lineDelivery.key === 'undelivered' && styles.valueMuted,
                    ]}
                  >
                    {formatLineQty(lineDelivery.delivered)} of {formatLineQty(lineDelivery.ordered)}
                  </Text>
                </View>
                <View style={styles.compactField}>
                  <Text style={styles.compactFieldLabel}>Unit</Text>
                  <Text style={styles.compactFieldValue}>
                    {formatUnitCost(moneyLine.displayUnitPrice, unitType)}
                  </Text>
                </View>
                <View style={[styles.compactField, styles.compactFieldEnd]}>
                  <Text style={styles.compactFieldLabel}>Amount</Text>
                  <Text style={styles.compactAmount}>{formatMoney(moneyLine.lineTotal)}</Text>
                </View>
              </View>
            </View>
          );
        }
        return (
          <View key={item.id || `${name}-${index}`} style={[styles.itemsRow, last && styles.rowLast]}>
            <LineThumb urls={images} name={name} />
            <View style={styles.colItem}>
              <Text style={styles.itemName} numberOfLines={2}>
                {name}
              </Text>
              {meta ? (
                <Text style={styles.itemMeta} numberOfLines={1}>
                  {meta}
                </Text>
              ) : null}
            </View>
            <Text style={[styles.typeBadge, styles.colType, styles[`type_${typeTone(lineType)}`]]} numberOfLines={1}>
              {lineType || '—'}
            </Text>
            <Text style={[styles.cell, styles.colQty]}>{formatLineQty(lineDelivery.ordered)}</Text>
            <Text
              style={[
                styles.cell,
                styles.colDelivered,
                lineDelivery.key === 'delivered' && styles.valueOk,
                lineDelivery.key === 'partial' && styles.valueWarn,
                lineDelivery.key === 'undelivered' && styles.valueMuted,
              ]}
            >
              {formatLineQty(lineDelivery.delivered)} of {formatLineQty(lineDelivery.ordered)}
            </Text>
            <Text style={[styles.cell, styles.colUnit]}>
              {formatUnitCost(moneyLine.displayUnitPrice, unitType)}
            </Text>
            <Text style={[styles.cell, styles.colAmount, styles.colRight]}>
              {formatMoney(moneyLine.lineTotal)}
            </Text>
          </View>
        );
      })}
    </>
  );

  return (
    <View style={styles.root}>
      {isMobile ? (
        <View style={styles.mobileTitleLayer} pointerEvents="box-none">
          <View style={styles.mobileTitleBlock}>
            <View style={styles.mobileTitleRow}>
              <Text style={styles.mobileStore} numberOfLines={1}>
                {storeName || locationName || 'Store'}
              </Text>
              <Text style={styles.mobileSep} accessible={false}>
                /
              </Text>
              <Text style={styles.mobileDoc} numberOfLines={1}>
                {crumb}
              </Text>
            </View>
            <Text style={styles.mobileDate} numberOfLines={1}>
              {occurred || periodLabel}
            </Text>
          </View>
        </View>
      ) : null}

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          isMobile
            ? { paddingTop: 62, paddingBottom: mobileTabBarReserve() + 24 }
            : { paddingTop: topInset + 12, paddingBottom: 48 },
        ]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={[styles.pane, isMobile && styles.paneMobile]}>
          {!isMobile ? (
            <View style={styles.docBar}>
              <View style={styles.docKindRow}>
                <View style={[styles.kindChip, { backgroundColor: theme.tint }]}>
                  <Text style={[styles.kindChipText, { color: theme.accent }]}>{docKind}</Text>
                </View>
                <Text style={styles.docTitle} numberOfLines={1}>
                  {crumb}
                </Text>
              </View>
              <Text style={styles.docMeta} numberOfLines={1}>
                {clientName || docLabel}
              </Text>
            </View>
          ) : null}

          <View style={[styles.ticketBar, compact && styles.ticketBarStack]}>
            <TicketCard style={[styles.totalsCard, compact && styles.cardFull]}>
              {charges ? (
                <View style={styles.totalsRow}>
                  <Text style={styles.totalsLabel}>Charges</Text>
                  <Text style={styles.totalsAmount}>{formatMoney(charges)}</Text>
                </View>
              ) : (
                <View style={styles.totalsRow}>
                  <Text style={styles.totalsLabel}>Items</Text>
                  <Text style={styles.totalsAmount}>
                    {items.length ? String(items.length) : loading ? '…' : '0'}
                  </Text>
                </View>
              )}
              <View
                style={[
                  styles.totalsRow,
                  styles.totalsRowGrand,
                  { backgroundColor: theme.tint, borderTopColor: theme.line },
                ]}
              >
                <Text style={[styles.totalsGrandLabel, { color: theme.accent }]}>Total</Text>
                <Text style={styles.totalsGrandAmount}>{formatMoney(totalAmount)}</Text>
              </View>
            </TicketCard>

            <View style={[styles.metaCluster, compact && styles.ticketBarStack]}>
              <TicketCard style={[styles.metaCard, compact && styles.cardFull]}>
                <FieldRow label="Customer" value={clientName} sub={client?.email || client?.phone} />
                <FieldRow
                  label="Allocation"
                  value={allocation?.label}
                  sub={allocationSub}
                  tone={toneStyle(allocation?.key)}
                />
                <FieldRow
                  label="Delivery"
                  value={delivery?.label}
                  sub={deliverySub}
                  tone={toneStyle(delivery?.key)}
                />
                <FieldRow label="Payment" value={paymentLabel} last />
              </TicketCard>

              <TicketCard style={[styles.metaCard, compact && styles.cardFull]}>
                <FieldRow label="Employee" value={summary.employeeName} />
                <FieldRow label="Store" value={locationName} sub={locationLine} />
                <FieldRow label="Date" value={summary.dateLabel || periodLabel} />
                <FieldRow label="Time" value={summary.timeLabel} last />
              </TicketCard>
            </View>
          </View>

          <View style={styles.section}>
            <View style={styles.sectionHead}>
              <Text style={styles.sectionTitle}>Items</Text>
              <Text style={styles.sectionMeta}>
                {items.length
                  ? `${items.length} line${items.length === 1 ? '' : 's'}`
                  : loading
                    ? 'Loading'
                    : 'None'}
              </Text>
            </View>
            <TicketCard style={styles.itemsCard}>{itemsBody}</TicketCard>
          </View>

          {!loading && payments.length > 0 ? (
            <View style={styles.section}>
              <View style={styles.sectionHead}>
                <Text style={styles.sectionTitle}>Payments</Text>
                <Text style={styles.sectionMeta}>
                  {payments.length} {payments.length === 1 ? 'row' : 'rows'}
                </Text>
              </View>
              <TicketCard>
                {payments.map((entry, index) => {
                  const payment = entry.payment || entry;
                  const method =
                    payment.payment_type?.name || entry.payment?.payment_type?.name || 'Payment';
                  return (
                    <FieldRow
                      key={entry.id || payment.id || `${method}-${index}`}
                      label={method}
                      value={formatMoney(entry.amount ?? payment.amount)}
                      sub={[payment.status, payment.date].filter(Boolean).join(' · ')}
                      last={index === payments.length - 1}
                    />
                  );
                })}
              </TicketCard>
            </View>
          ) : null}

          {detail?.comments ? (
            <View style={styles.section}>
              <View style={styles.sectionHead}>
                <Text style={styles.sectionTitle}>Notes</Text>
              </View>
              <TicketCard>
                <Text style={styles.notes}>{detail.comments}</Text>
              </TicketCard>
            </View>
          ) : null}

          {onClose && !isMobile ? (
            <Pressable
              onPress={onClose}
              style={({ hovered, pressed }) => [
                styles.backRow,
                (hovered || pressed) && styles.backRowActive,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Back to store"
            >
              <Ionicons name="chevron-back" size={16} color={SECONDARY} />
              <Text style={styles.backText}>Back to {storeName || 'store'}</Text>
            </Pressable>
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    minHeight: 0,
    backgroundColor: CANVAS,
  },
  scroll: {
    flex: 1,
    minHeight: 0,
  },
  scrollContent: {
    flexGrow: 1,
  },
  pane: {
    width: '88%',
    maxWidth: 980,
    alignSelf: 'center',
  },
  paneMobile: {
    width: '100%',
    maxWidth: '100%',
    paddingHorizontal: MOBILE_FILTER_INSET,
  },
  mobileTitleLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 5,
    paddingHorizontal: MOBILE_FILTER_INSET,
    paddingTop: 6,
  },
  mobileTitleBlock: {
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 56,
  },
  mobileTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    maxWidth: '100%',
    gap: 6,
  },
  mobileStore: {
    flexShrink: 1,
    minWidth: 0,
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: LABEL,
    letterSpacing: -0.2,
  },
  mobileSep: {
    fontFamily,
    fontSize: 15,
    fontWeight: '400',
    color: '#c7c7cc',
  },
  mobileDoc: {
    flexShrink: 0,
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: LABEL,
    letterSpacing: -0.2,
  },
  mobileDate: {
    marginTop: 2,
    fontFamily,
    fontSize: 12,
    fontWeight: '500',
    color: SECONDARY,
  },
  docBar: {
    marginBottom: 16,
    gap: 4,
  },
  docKindRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  kindChip: {
    minWidth: 36,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    alignItems: 'center',
  },
  kindChipText: {
    fontFamily,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  docTitle: {
    flex: 1,
    minWidth: 0,
    fontFamily,
    fontSize: 22,
    fontWeight: '600',
    color: LABEL,
    letterSpacing: -0.4,
  },
  docMeta: {
    fontFamily,
    fontSize: 14,
    fontWeight: '500',
    color: SECONDARY,
    paddingLeft: 46,
  },
  ticketBar: {
    flexDirection: 'row',
    alignItems: 'stretch',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 22,
  },
  ticketBarStack: {
    flexDirection: 'column',
    alignItems: 'stretch',
  },
  metaCluster: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 12,
  },
  ticketCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: HAIRLINE,
    borderRadius: 12,
    backgroundColor: '#fff',
    overflow: 'hidden',
    ...Platform.select({
      web: { boxShadow: '0 8px 24px rgba(0,0,0,0.04)' },
      default: {},
    }),
  },
  totalsCard: {
    width: 252,
    maxWidth: '100%',
    flexShrink: 0,
  },
  metaCard: {
    flex: 1,
    minWidth: 0,
  },
  cardFull: {
    width: '100%',
  },
  totalsRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 16,
    minHeight: 44,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  totalsRowGrand: {
    alignItems: 'center',
    minHeight: 58,
    paddingVertical: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  totalsLabel: {
    fontFamily,
    fontSize: 13,
    fontWeight: '500',
    color: MUTED,
  },
  totalsAmount: {
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: LABEL,
    letterSpacing: -0.2,
    fontVariant: ['tabular-nums'],
    textAlign: 'right',
  },
  totalsGrandLabel: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
  },
  totalsGrandAmount: {
    fontFamily,
    fontSize: 26,
    fontWeight: '600',
    color: LABEL,
    letterSpacing: -0.6,
    fontVariant: ['tabular-nums'],
    textAlign: 'right',
  },
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    minHeight: 42,
    paddingHorizontal: 14,
    paddingVertical: 8,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: ROW_RULE,
  },
  fieldRowLast: {
    borderBottomWidth: 0,
  },
  fieldLabel: {
    fontFamily,
    width: 86,
    flexShrink: 0,
    fontSize: 13,
    fontWeight: '500',
    color: MUTED,
    paddingTop: 2,
  },
  fieldValueWrap: {
    flex: 1,
    minWidth: 0,
    alignItems: 'flex-end',
  },
  fieldValue: {
    fontFamily,
    fontSize: 15,
    fontWeight: '500',
    color: LABEL,
    textAlign: 'right',
    letterSpacing: -0.15,
  },
  fieldSub: {
    marginTop: 2,
    fontFamily,
    fontSize: 12,
    color: SECONDARY,
    textAlign: 'right',
  },
  valueOk: {
    color: '#15803D',
  },
  valueWarn: {
    color: '#B45309',
  },
  valueMuted: {
    color: SECONDARY,
  },
  section: {
    marginBottom: 22,
  },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  sectionTitle: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: LABEL,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  sectionMeta: {
    fontFamily,
    fontSize: 12,
    fontWeight: '500',
    color: SECONDARY,
  },
  itemsCard: {
    overflow: 'hidden',
  },
  itemsHead: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 34,
    paddingHorizontal: 10,
    backgroundColor: '#f6f6f9',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: ROW_RULE,
    gap: 4,
  },
  itemsHeadLabel: {
    fontFamily,
    fontSize: 11,
    fontWeight: '600',
    color: SECONDARY,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
    paddingHorizontal: 6,
  },
  itemsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 48,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: ROW_RULE,
    gap: 4,
  },
  rowLast: {
    borderBottomWidth: 0,
  },
  thumbSlot: {
    width: 28,
    height: 28,
    borderRadius: 7,
    flexShrink: 0,
    marginLeft: 6,
  },
  thumbPress: {
    width: 28,
    height: 28,
    borderRadius: 7,
    overflow: 'hidden',
    flexShrink: 0,
    marginLeft: 6,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  thumb: {
    width: 28,
    height: 28,
    borderRadius: 7,
    backgroundColor: '#ececef',
  },
  thumbBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    minWidth: 14,
    height: 14,
    borderRadius: 7,
    paddingHorizontal: 3,
    backgroundColor: LABEL,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbBadgeText: {
    fontFamily,
    fontSize: 9,
    fontWeight: '700',
    color: '#fff',
  },
  colItem: {
    flex: 2,
    minWidth: 0,
    paddingHorizontal: 6,
  },
  colType: {
    width: 92,
    flexShrink: 0,
    paddingHorizontal: 6,
  },
  colQty: {
    width: 56,
    flexShrink: 0,
    paddingHorizontal: 6,
  },
  colDelivered: {
    width: 108,
    flexShrink: 0,
    paddingHorizontal: 6,
  },
  colUnit: {
    width: 88,
    flexShrink: 0,
    paddingHorizontal: 6,
  },
  colAmount: {
    width: 96,
    flexShrink: 0,
    paddingHorizontal: 6,
  },
  colRight: {
    textAlign: 'right',
  },
  typeBadge: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
  },
  typeBadgeCompact: {
    fontSize: 11,
    letterSpacing: 0.2,
    textTransform: 'uppercase',
    width: 72,
    flexShrink: 0,
    textAlign: 'right',
  },
  type_bullion: {
    color: '#1F8A4E',
  },
  type_scrap: {
    color: '#C2410C',
  },
  type_watch: {
    color: '#1D4ED8',
  },
  type_diamond: {
    color: '#0F766E',
  },
  type_numismatic: {
    color: '#A67C2D',
  },
  type_neutral: {
    color: MUTED,
  },
  itemName: {
    fontFamily,
    fontSize: 15,
    fontWeight: '500',
    color: LABEL,
    letterSpacing: -0.15,
  },
  itemMeta: {
    marginTop: 2,
    fontFamily,
    fontSize: 12,
    color: SECONDARY,
  },
  cell: {
    fontFamily,
    fontSize: 14,
    fontWeight: '500',
    color: LABEL,
    fontVariant: ['tabular-nums'],
  },
  compactRow: {
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 12,
    gap: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: ROW_RULE,
  },
  compactTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  compactNameCell: {
    flex: 1,
    minWidth: 0,
  },
  compactBottom: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
  },
  compactField: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  compactFieldEnd: {
    alignItems: 'flex-end',
  },
  compactFieldLabel: {
    fontFamily,
    fontSize: 10,
    fontWeight: '600',
    color: SECONDARY,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  compactFieldValue: {
    fontFamily,
    fontSize: 13,
    fontWeight: '500',
    color: LABEL,
    fontVariant: ['tabular-nums'],
  },
  compactAmount: {
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: LABEL,
    fontVariant: ['tabular-nums'],
  },
  notes: {
    fontFamily,
    fontSize: 14,
    lineHeight: 20,
    color: LABEL,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  empty: {
    fontFamily,
    fontSize: 14,
    color: SECONDARY,
    textAlign: 'center',
    paddingHorizontal: 16,
    paddingVertical: 28,
  },
  loading: {
    paddingVertical: 36,
    alignItems: 'center',
  },
  backRow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    marginTop: 4,
    paddingVertical: 8,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  backRowActive: {
    opacity: 0.7,
  },
  backText: {
    fontFamily,
    fontSize: 14,
    fontWeight: '500',
    color: SECONDARY,
  },
  viewerRoot: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.86)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  viewerImage: {
    width: '100%',
    height: '80%',
  },
});
