import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
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
import { API_BASE_URL } from '../lib/auth';
import { MOBILE, mobileSafeBottom, mobileSafeTop } from '../lib/mobileUi';
import {
  fetchTransactionDetail,
  findLookupTransaction,
  formatAmount,
  formatUnitCost,
  lineItemMoney,
  parseDocReference,
} from '../lib/transactions';

const fontFamily = Platform.select({
  ios: 'Sohne',
  android: 'Sohne',
  default: 'Sohne',
});

const BLUE = MOBILE.blue;
const TEXT = '#1d1d1f';
const SECONDARY = '#8e8e93';
const FILL = 'rgba(118, 118, 128, 0.12)';
const PAGE = MOBILE.bg;
const HAIRLINE = MOBILE.separator;
const LINK = BLUE;
const MOBILE_BREAKPOINT = 768;
const DRAWER_OPEN_MS = 280;
const DRAWER_CLOSE_MS = 220;
const DOC_REF_RE = /\b(SO|PO)\s*#?\s*(\d+)\b/gi;

function useHeldValue(value) {
  const held = useRef(value);
  if (value != null) held.current = value;
  return value ?? held.current;
}

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

function stripMarkdown(text) {
  return String(text || '')
    .replace(/```[\s\S]*?```/g, (block) =>
      block.replace(/^```[a-z]*\s*/i, '').replace(/\s*```$/, ''),
    )
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/(^|[\s(])\*(.+?)\*(?=[\s).,]|$)/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^\s*>\s+/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function parseAuditAiLayout(text) {
  const raw = stripMarkdown(text);
  const headerRe = /^(problem|solution|reasons)\s*:?[ \t]*/gim;
  const matches = [...raw.matchAll(headerRe)];
  if (!matches.length) {
    return { structured: false, raw };
  }

  const parts = {};
  for (let i = 0; i < matches.length; i += 1) {
    const key = matches[i][1].toLowerCase();
    const start = matches[i].index + matches[i][0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index : raw.length;
    parts[key] = raw.slice(start, end).trim();
  }

  return {
    structured: true,
    raw,
    preamble: raw.slice(0, matches[0].index).trim(),
    problem: parts.problem || '',
    solution: parts.solution || '',
    reasons: (parts.reasons || '')
      .split(/\n+/)
      .map((line) => line.replace(/^\s*(?:\d+[.)]\s*|[-–—•]\s*)/, '').trim())
      .filter(Boolean),
  };
}

function LinkedAuditText({ text, onOpenReference, style }) {
  const value = String(text || '');
  if (!value) return null;

  const nodes = [];
  let lastIndex = 0;
  const re = new RegExp(DOC_REF_RE.source, 'gi');
  let match = re.exec(value);

  while (match) {
    if (match.index > lastIndex) {
      nodes.push(value.slice(lastIndex, match.index));
    }
    const parsed = parseDocReference(match[0]);
    if (parsed && onOpenReference) {
      nodes.push(
        <Text
          key={`${parsed.key}-${match.index}`}
          style={styles.docLink}
          onPress={() => onOpenReference(parsed)}
          accessibilityRole="link"
          accessibilityLabel={`Open ${parsed.reference}`}
        >
          {parsed.reference}
        </Text>,
      );
    } else {
      nodes.push(match[0]);
    }
    lastIndex = match.index + match[0].length;
    match = re.exec(value);
  }

  if (lastIndex < value.length) {
    nodes.push(value.slice(lastIndex));
  }

  return <Text style={[styles.bodyText, style]}>{nodes}</Text>;
}

function AuditAiMessage({ content, streaming = false, onOpenReference }) {
  const parsed = parseAuditAiLayout(content);
  if (!parsed.structured) {
    return (
      <LinkedAuditText
        text={parsed.raw || (streaming ? '…' : '')}
        onOpenReference={onOpenReference}
      />
    );
  }

  return (
    <View style={styles.layout}>
      {parsed.preamble ? (
        <LinkedAuditText text={parsed.preamble} onOpenReference={onOpenReference} />
      ) : null}

      {parsed.problem ? (
        <View style={styles.block}>
          <Text style={styles.blockLabel}>Problem</Text>
          <LinkedAuditText text={parsed.problem} onOpenReference={onOpenReference} />
        </View>
      ) : null}

      {parsed.solution ? (
        <View style={styles.block}>
          <Text style={styles.blockLabel}>Solution</Text>
          <LinkedAuditText text={parsed.solution} onOpenReference={onOpenReference} />
        </View>
      ) : null}

      {parsed.reasons.length ? (
        <View style={styles.block}>
          <Text style={styles.blockLabel}>Reasons</Text>
          <View style={styles.reasonList}>
            {parsed.reasons.map((reason, index) => (
              <LinkedAuditText
                key={`${index}-${reason.slice(0, 24)}`}
                text={reason}
                onOpenReference={onOpenReference}
              />
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}

export function AuditAiChat({
  turns,
  draft,
  onChangeDraft,
  onSend,
  busy = false,
  disabled = false,
  placeholder = 'Ask a follow-up…',
  onOpenReference,
}) {
  const canSend = Boolean(String(draft || '').trim()) && !busy && !disabled;

  if (!turns?.length) return null;

  return (
    <View style={styles.chat}>
      {turns.map((turn, index) => {
        const isUser = turn.role === 'user';
        const isStreamingTail =
          busy && !isUser && index === turns.length - 1 && !String(turn.content || '').trim();
        return (
          <View
            key={`${turn.role}-${index}`}
            style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleAssistant]}
          >
            {isUser ? (
              <Text style={styles.bodyTextUser}>{turn.content || ''}</Text>
            ) : (
              <AuditAiMessage
                content={turn.content || ''}
                streaming={isStreamingTail}
                onOpenReference={onOpenReference}
              />
            )}
          </View>
        );
      })}

      {!disabled ? (
        <View style={styles.composer}>
          <TextInput
            style={styles.input}
            value={draft}
            onChangeText={onChangeDraft}
            placeholder={placeholder}
            placeholderTextColor={SECONDARY}
            editable={!busy}
            multiline
            blurOnSubmit={false}
            onSubmitEditing={() => {
              if (canSend) onSend?.();
            }}
          />
          <Pressable
            style={[styles.send, !canSend && styles.sendDisabled]}
            onPress={onSend}
            disabled={!canSend}
            accessibilityLabel="Send follow-up"
          >
            {busy ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Ionicons name="arrow-up" size={18} color="#fff" />
            )}
          </Pressable>
        </View>
      ) : null}
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

  if (item?.unit_type) {
    const qty = item.quantity ?? item.gross_quantity;
    if (qty != null) bits.push(`${qty} ${item.unit_type}`);
  }

  return bits.join(' · ');
}

function lineItemQty(item) {
  const qty = item?.quantity ?? item?.gross_quantity ?? 1;
  return String(qty);
}

function DetailRow({ label, value, sub, last }) {
  return (
    <View style={[styles.detailRow, last && styles.rowLast]}>
      <Text style={styles.detailLabel}>{label}</Text>
      <View style={styles.detailValueWrap}>
        <Text style={styles.detailValue} numberOfLines={2}>
          {value || '—'}
        </Text>
        {sub ? (
          <Text style={styles.detailSub} numberOfLines={2}>
            {sub}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

export function AuditTxnDrawer({ visible, summary, detail, loading, error, onClose }) {
  const { width: windowWidth } = useWindowDimensions();
  const isMobile = windowWidth < MOBILE_BREAKPOINT;
  const panelWidth = isMobile
    ? Math.max(windowWidth, 240)
    : Math.min(Math.max(Math.round(windowWidth * 0.48), 420), Math.round(windowWidth - 80));
  const { mounted, slide, backdrop } = useRightDrawerAnimation(visible, panelWidth);
  const heldSummary = useHeldValue(summary);
  const heldDetail = useHeldValue(detail);

  if (!mounted || !heldSummary) return null;

  const client = heldDetail?.client;
  const clientName = client
    ? [client.first_name, client.last_name].filter(Boolean).join(' ').trim()
    : heldSummary.customerName;
  const location = heldDetail?.location;
  const locationName = location?.name || heldSummary.storeName;
  const items = Array.isArray(heldDetail?.items) ? heldDetail.items : [];
  const payments = Array.isArray(heldDetail?.payments) ? heldDetail.payments : [];
  const totalAmount = heldDetail?.total_amount ?? heldSummary.amount;
  const docLabel = heldSummary.type === 'purchase' ? 'Purchase order' : 'Sales invoice';
  const partyLabel = heldSummary.type === 'purchase' ? 'Vendor / customer' : 'Bill to';
  const statusBits = [
    heldDetail?.payment_status,
    heldDetail?.item_status,
    heldDetail?.allocation_status,
  ].filter(Boolean);

  return (
    <Modal visible={mounted} transparent animationType="none" onRequestClose={onClose}>
      <View style={styles.drawerRoot}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose}>
          <Animated.View style={[styles.drawerBackdrop, { opacity: backdrop }]} />
        </Pressable>

        <Animated.View style={[styles.drawerPanel, isMobile && styles.drawerPanelMobile, { width: panelWidth, transform: [{ translateX: slide }] }]}>
          <View
            style={[styles.navBar, isMobile && styles.navBarMobile]}
            {...(Platform.OS === 'web' && isMobile ? { className: 'cgold-mobile-sheet-top' } : null)}
          >
            <Pressable
              onPress={onClose}
              hitSlop={8}
              style={styles.navSide}
              accessibilityLabel="Close"
            >
              <Text style={styles.navAction}>Close</Text>
            </Pressable>
            <Text style={styles.navTitle} numberOfLines={1}>
              {docLabel}
            </Text>
            <View style={styles.navSide} />
          </View>

          <ScrollView
            style={styles.drawerBody}
            contentContainerStyle={[
              styles.drawerBodyContent,
              isMobile && styles.drawerBodyContentMobile,
            ]}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.hero}>
              <Text style={styles.heroName} numberOfLines={2}>
                {clientName || '—'}
              </Text>
              <Text style={styles.heroMeta} numberOfLines={1}>
                {heldSummary.reference}
                {heldSummary.dateLabel
                  ? ` · ${heldSummary.dateLabel} ${heldSummary.timeLabel || ''}`.trim()
                  : ''}
              </Text>
              <Text style={styles.heroAmount}>{formatAmount(totalAmount)}</Text>
              {statusBits.length ? (
                <View style={styles.statusRow}>
                  {statusBits.map((status) => (
                    <View key={status} style={styles.statusChip}>
                      <Text style={styles.statusText}>{status}</Text>
                    </View>
                  ))}
                </View>
              ) : null}
            </View>

            <View style={styles.group}>
              <DetailRow label={partyLabel} value={clientName} />
              {client?.email ? <DetailRow label="Email" value={client.email} /> : null}
              <DetailRow
                label="Date"
                value={
                  heldSummary.dateLabel
                    ? `${heldSummary.dateLabel}${heldSummary.timeLabel ? ` · ${heldSummary.timeLabel}` : ''}`
                    : heldSummary.date || '—'
                }
              />
              <DetailRow label="Store" value={locationName} />
              <DetailRow label="Employee" value={heldSummary.employeeName} last />
            </View>

            {loading ? (
              <View style={styles.drawerLoading}>
                <ActivityIndicator color={TEXT} />
              </View>
            ) : null}

            {error ? <Text style={styles.errorText}>{error}</Text> : null}

            {!loading ? (
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>Line items</Text>
                <View style={styles.group}>
                  <View style={styles.tableHeader}>
                    <Text style={[styles.colItem, styles.tableHeaderText]}>Item</Text>
                    <Text style={[styles.colQty, styles.tableHeaderText]}>Qty</Text>
                    <Text style={[styles.colUnit, styles.tableHeaderText]}>Unit</Text>
                    <Text style={[styles.colAmount, styles.tableHeaderText]}>Amount</Text>
                  </View>
                  {items.length === 0 ? (
                    <Text style={styles.emptyLine}>No line items</Text>
                  ) : (
                    items.map((item, index) => {
                      const name = lineItemName(item);
                      const meta = lineItemMeta(item);
                      const money = lineItemMoney(item);
                      const unitType = item?.unit_type || (money.grossQuantity ? 'g' : '');
                      return (
                        <View
                          key={item.id || `${name}-${index}`}
                          style={[
                            styles.tableRow,
                            index === items.length - 1 && !heldDetail?.total_charges && styles.rowLast,
                          ]}
                        >
                          <View style={styles.colItem}>
                            <Text style={styles.itemName}>{name}</Text>
                            {meta ? <Text style={styles.itemMeta}>{meta}</Text> : null}
                          </View>
                          <Text style={[styles.colQty, styles.cell]}>{lineItemQty(item)}</Text>
                          <Text style={[styles.colUnit, styles.cell]}>
                            {formatUnitCost(money.displayUnitPrice, unitType)}
                          </Text>
                          <Text style={[styles.colAmount, styles.cell]}>
                            {formatAmount(money.lineTotal)}
                          </Text>
                        </View>
                      );
                    })
                  )}
                  {heldDetail?.total_charges ? (
                    <View style={styles.tableRow}>
                      <Text style={styles.muted}>Charges</Text>
                      <Text style={[styles.colAmount, styles.muted]}>
                        {formatAmount(heldDetail.total_charges)}
                      </Text>
                    </View>
                  ) : null}
                  <View style={[styles.tableRow, styles.rowLast]}>
                    <Text style={styles.totalLabel}>Total</Text>
                    <Text style={[styles.colAmount, styles.totalValue]}>
                      {formatAmount(totalAmount)}
                    </Text>
                  </View>
                </View>
              </View>
            ) : null}

            {!loading && payments.length > 0 ? (
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>Payments</Text>
                <View style={styles.group}>
                  {payments.map((entry, index) => {
                    const payment = entry.payment || entry;
                    const method =
                      payment.payment_type?.name ||
                      entry.payment?.payment_type?.name ||
                      'Payment';
                    return (
                      <View
                        key={entry.id || payment.id || `${method}-${index}`}
                        style={[styles.paymentRow, index === payments.length - 1 && styles.rowLast]}
                      >
                        <View style={styles.colItem}>
                          <Text style={styles.itemName}>{method}</Text>
                          <Text style={styles.itemMeta}>
                            {[payment.status, payment.date].filter(Boolean).join(' · ')}
                          </Text>
                        </View>
                        <Text style={[styles.colAmount, styles.cell]}>
                          {formatAmount(entry.amount ?? payment.amount)}
                        </Text>
                      </View>
                    );
                  })}
                </View>
              </View>
            ) : null}

            {heldDetail?.comments ? (
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>Notes</Text>
                <View style={styles.group}>
                  <Text style={styles.notes}>{heldDetail.comments}</Text>
                </View>
              </View>
            ) : null}
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

export function useAuditTxnDrawer(session, fallbackAuth) {
  const [visible, setVisible] = useState(false);
  const [summary, setSummary] = useState(null);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const lookupRef = useRef([]);
  const requestId = useRef(0);

  const setLookup = useCallback((rows) => {
    lookupRef.current = Array.isArray(rows) ? rows : [];
  }, []);

  const close = useCallback(() => {
    setVisible(false);
  }, []);

  const openReference = useCallback(
    async (ref) => {
      const parsed = parseDocReference(ref);
      if (!parsed) return;

      const found = findLookupTransaction(lookupRef.current, parsed);
      const token = found?.token || fallbackAuth?.token || session?.token;
      const baseUrl = found?.baseUrl || fallbackAuth?.baseUrl || session?.baseUrl || API_BASE_URL;
      if (!token) {
        setSummary({
          ...parsed,
          customerName: found?.customerName,
          employeeName: found?.employeeName,
          storeName: found?.storeName,
          amount: found?.amount,
          amountLabel: found?.amountLabel,
          date: found?.date,
          dateLabel: found?.dateLabel,
          timeLabel: found?.timeLabel,
        });
        setDetail(null);
        setError('Sign in to open this document.');
        setLoading(false);
        setVisible(true);
        return;
      }

      const nextSummary = {
        reference: parsed.reference,
        type: parsed.type,
        sourceId: found?.sourceId || parsed.sourceId,
        customerName: found?.customerName,
        employeeName: found?.employeeName,
        storeName: found?.storeName,
        amount: found?.amount,
        amountLabel: found?.amountLabel,
        date: found?.date,
        dateLabel: found?.dateLabel,
        timeLabel: found?.timeLabel,
      };

      const id = ++requestId.current;
      setSummary(nextSummary);
      setDetail(null);
      setError('');
      setLoading(true);
      setVisible(true);

      try {
        const next = await fetchTransactionDetail(token, {
          type: nextSummary.type,
          sourceId: nextSummary.sourceId,
          baseUrl,
        });
        if (id !== requestId.current) return;
        setDetail(next);
      } catch (err) {
        if (id !== requestId.current) return;
        setError(err?.message || 'Failed to load this document.');
      } finally {
        if (id === requestId.current) setLoading(false);
      }
    },
    [session, fallbackAuth],
  );

  return useMemo(
    () => ({
      visible,
      summary,
      detail,
      loading,
      error,
      openReference,
      close,
      setLookup,
    }),
    [visible, summary, detail, loading, error, openReference, close, setLookup],
  );
}

const styles = StyleSheet.create({
  chat: {
    gap: 8,
  },
  bubble: {
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 10,
    maxWidth: '84%',
  },
  bubbleAssistant: {
    alignSelf: 'flex-start',
    backgroundColor: '#E9E9EB',
  },
  bubbleUser: {
    alignSelf: 'flex-end',
    backgroundColor: BLUE,
  },
  layout: {
    gap: 12,
  },
  block: {
    gap: 4,
  },
  blockLabel: {
    fontFamily,
    fontSize: 13,
    fontWeight: '400',
    color: SECONDARY,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  reasonList: {
    gap: 8,
  },
  bodyText: {
    fontFamily,
    fontSize: 17,
    lineHeight: 22,
    color: TEXT,
    letterSpacing: -0.3,
  },
  bodyTextUser: {
    fontFamily,
    fontSize: 17,
    lineHeight: 22,
    color: '#fff',
    letterSpacing: -0.3,
  },
  docLink: {
    color: LINK,
    fontWeight: '500',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingTop: 4,
  },
  input: {
    flex: 1,
    minHeight: 36,
    maxHeight: 120,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 8,
    fontFamily,
    fontSize: 17,
    color: TEXT,
    backgroundColor: FILL,
    ...Platform.select({
      web: { outlineStyle: 'none' },
      default: {},
    }),
  },
  send: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: BLUE,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  sendDisabled: {
    opacity: 0.35,
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
    backgroundColor: PAGE,
    ...Platform.select({
      web: {
        boxShadow: '-12px 0 32px rgba(0,0,0,0.18)',
      },
      default: {
        elevation: 12,
      },
    }),
  },
  drawerPanelMobile: {
    paddingBottom: Platform.OS === 'ios' ? Math.max(20, mobileSafeBottom()) : 12,
  },
  navBar: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 52,
    paddingHorizontal: 8,
    backgroundColor: 'rgba(242,242,247,0.94)',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: HAIRLINE,
  },
  navBarMobile: {
    paddingTop: Platform.OS === 'ios' ? mobileSafeTop() - 12 : 6,
  },
  navSide: {
    width: 72,
    minHeight: 44,
    justifyContent: 'center',
    ...Platform.select({
      web: { cursor: 'pointer' },
      default: {},
    }),
  },
  navAction: {
    fontFamily,
    fontSize: 17,
    fontWeight: '400',
    color: BLUE,
  },
  navTitle: {
    fontFamily,
    flex: 1,
    fontSize: 17,
    fontWeight: '600',
    color: TEXT,
    textAlign: 'center',
    letterSpacing: -0.3,
  },
  drawerBody: {
    flex: 1,
    minHeight: 0,
  },
  drawerBodyContent: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 48,
  },
  drawerBodyContentMobile: {
    paddingHorizontal: 16,
    paddingBottom: 32,
  },
  hero: {
    paddingBottom: 24,
    paddingHorizontal: 4,
  },
  heroName: {
    fontFamily,
    fontSize: 28,
    fontWeight: '700',
    color: TEXT,
    letterSpacing: -0.6,
  },
  heroMeta: {
    fontFamily,
    fontSize: 15,
    color: SECONDARY,
    letterSpacing: -0.2,
    marginTop: 4,
  },
  heroAmount: {
    fontFamily,
    fontSize: 34,
    fontWeight: '700',
    color: TEXT,
    letterSpacing: -0.8,
    fontVariant: ['tabular-nums'],
    marginTop: 8,
  },
  statusRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  },
  statusChip: {
    backgroundColor: FILL,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  statusText: {
    fontFamily,
    fontSize: 13,
    color: TEXT,
    fontWeight: '500',
    letterSpacing: -0.08,
  },
  group: {
    backgroundColor: '#fff',
    borderRadius: 12,
    overflow: 'hidden',
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    minHeight: 44,
    paddingVertical: 11,
    paddingHorizontal: 16,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: HAIRLINE,
  },
  rowLast: {
    borderBottomWidth: 0,
  },
  detailLabel: {
    fontFamily,
    width: 108,
    flexShrink: 0,
    fontSize: 17,
    color: TEXT,
    letterSpacing: -0.3,
    paddingTop: 1,
  },
  detailValueWrap: {
    flex: 1,
    minWidth: 0,
    alignItems: 'flex-end',
  },
  detailValue: {
    fontFamily,
    fontSize: 17,
    color: TEXT,
    letterSpacing: -0.3,
    textAlign: 'right',
  },
  detailSub: {
    fontFamily,
    fontSize: 13,
    color: SECONDARY,
    letterSpacing: -0.08,
    textAlign: 'right',
    marginTop: 2,
  },
  section: {
    marginTop: 24,
  },
  sectionLabel: {
    fontFamily,
    fontSize: 13,
    fontWeight: '400',
    color: SECONDARY,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 6,
    paddingHorizontal: 4,
  },
  tableHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 32,
    paddingHorizontal: 16,
    backgroundColor: '#fff',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: HAIRLINE,
  },
  tableHeaderText: {
    fontFamily,
    fontSize: 13,
    fontWeight: '400',
    color: SECONDARY,
    letterSpacing: -0.08,
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    minHeight: 44,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: HAIRLINE,
    backgroundColor: '#fff',
  },
  colItem: {
    flex: 1,
    minWidth: 0,
    paddingRight: 16,
  },
  colQty: {
    width: 56,
    textAlign: 'right',
  },
  colUnit: {
    width: 88,
    textAlign: 'right',
  },
  colAmount: {
    width: 88,
    textAlign: 'right',
  },
  itemName: {
    fontFamily,
    fontSize: 17,
    color: TEXT,
    letterSpacing: -0.3,
    lineHeight: 22,
  },
  itemMeta: {
    fontFamily,
    fontSize: 13,
    color: SECONDARY,
    letterSpacing: -0.08,
    marginTop: 2,
  },
  cell: {
    fontFamily,
    fontSize: 17,
    color: TEXT,
    letterSpacing: -0.3,
    fontVariant: ['tabular-nums'],
  },
  muted: {
    fontFamily,
    flex: 1,
    fontSize: 17,
    color: SECONDARY,
    letterSpacing: -0.3,
    fontVariant: ['tabular-nums'],
  },
  totalLabel: {
    fontFamily,
    flex: 1,
    fontSize: 17,
    fontWeight: '600',
    color: TEXT,
    letterSpacing: -0.3,
  },
  totalValue: {
    fontFamily,
    fontSize: 17,
    fontWeight: '600',
    color: TEXT,
    letterSpacing: -0.3,
    fontVariant: ['tabular-nums'],
  },
  paymentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 52,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: HAIRLINE,
    backgroundColor: '#fff',
  },
  notes: {
    fontFamily,
    fontSize: 17,
    lineHeight: 22,
    color: TEXT,
    letterSpacing: -0.3,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  emptyLine: {
    fontFamily,
    fontSize: 17,
    color: SECONDARY,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  drawerLoading: {
    paddingVertical: 36,
    alignItems: 'center',
  },
  errorText: {
    fontFamily,
    fontSize: 15,
    color: '#FF3B30',
    marginTop: 16,
    paddingHorizontal: 4,
  },
});
