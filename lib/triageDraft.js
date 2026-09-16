import { collectItemImageUrls, collectRecordImageUrls, formatAmount, lineItemMoney } from './transactions';

export const ERROR_TYPES = [
  'Wrong item',
  'Wrong quantity',
  'Wrong price',
  'Wrong customer',
  'Wrong payment',
  'Missing item',
];

export const VISIBLE_ERROR_TYPE_LIMIT = 5;

export function isListedErrorType(label) {
  const value = String(label || '').trim();
  return Boolean(value) && value.toLowerCase() !== 'other';
}

export function rankLabeledCounts(values, seeds = []) {
  const counts = new Map();
  for (const seed of seeds) {
    const label = String(seed || '').trim();
    if (label && !counts.has(label)) counts.set(label, 0);
  }
  for (const raw of values || []) {
    const label = String(raw || '').trim();
    if (!label) continue;
    counts.set(label, (counts.get(label) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
}

const KARAT_PURITIES = [
  { purity: 99.9, karat: 24 },
  { purity: 91.6, karat: 22 },
  { purity: 87.5, karat: 21 },
  { purity: 75.0, karat: 18 },
  { purity: 58.5, karat: 14 },
  { purity: 41.7, karat: 10 },
  { purity: 37.5, karat: 9 },
];

function karatFromPurity(purity) {
  if (purity == null || purity === '') return null;
  let n = Number(purity);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n > 0 && n <= 1) n *= 100;
  if ([24, 22, 21, 18, 14, 10, 9].includes(n)) return n;
  let best = null;
  for (const row of KARAT_PURITIES) {
    const delta = Math.abs(n - row.purity);
    if (delta <= 2 && (!best || delta < best.delta)) best = { karat: row.karat, delta };
  }
  return best?.karat ?? null;
}

function scrapKaratLabel(item) {
  const product = item?.product;
  const quality = String(
    item?.quality_mark_description || product?.quality_mark_description || '',
  ).trim();
  const fromText = quality.match(/\b(24|22|21|18|14|10|9)\s*[-]?\s*k(?:t|arat)?s?\b/i);
  if (fromText) return `${fromText[1]}K`;
  const purity = item?.purity ?? item?.purity_percent ?? item?.fineness ?? product?.purity;
  const karat = karatFromPurity(purity);
  if (karat) return `${karat}K`;
  if (quality && !/^scrap\b/i.test(quality)) return quality;
  return '';
}

export function lineItemName(item) {
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

  let name = candidates[0] || '';
  if (!name && product?.metal?.name) {
    name = product?.type === 'scrap' ? `Scrap ${product.metal.name}` : product.metal.name;
  }
  if (!name) return 'Untitled item';

  const isScrap =
    String(product?.type || item?.type || '').toLowerCase() === 'scrap' ||
    /\bscrap\b/i.test(name);
  if (!isScrap) return name;

  const karat = scrapKaratLabel(item);
  if (!karat) return name;
  if (name.toLowerCase().includes(karat.toLowerCase()) || /\b\d+\s*k(?:t|arat)?s?\b/i.test(name)) {
    return name;
  }
  return `${name} · ${karat}`;
}

export function lineItemQty(item) {
  const qty = item?.quantity ?? item?.gross_quantity ?? 1;
  return String(qty);
}

function qtyLabel(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  if (Number.isInteger(n)) return String(n);
  return String(Math.round(n * 1000) / 1000);
}

export function lineDeliveredQty(item) {
  const raw =
    item?.delivered_quantity ??
    item?.quantity_delivered ??
    item?.delivered_qty ??
    item?.delivery_quantity;
  const n = Number(raw);
  if (Number.isFinite(n)) return n;
  const status = String(
    item?.delivery_status || item?.delivered_status || item?.status || item?.item_status || '',
  );
  if (item?.delivered === true || item?.is_delivered === true || /delivered|complete|shipped/i.test(status)) {
    const qty = Number(item?.quantity ?? item?.gross_quantity);
    return Number.isFinite(qty) ? qty : null;
  }
  return null;
}

export function deliveredQtyRatio(item) {
  const qty = Number(item?.quantity ?? item?.gross_quantity);
  const delivered = lineDeliveredQty(item);
  return `${delivered == null ? '—' : qtyLabel(delivered)}/${Number.isFinite(qty) ? qtyLabel(qty) : '—'}`;
}

const UNIT_ALIASES = {
  g: 'g',
  gm: 'g',
  gram: 'g',
  grams: 'g',
  oz: 'oz',
  ozt: 'oz',
  troy: 'oz',
  dwt: 'dwt',
  kg: 'kg',
  kgs: 'kg',
  lb: 'lb',
  lbs: 'lb',
  ea: 'ea',
  each: 'ea',
  pc: 'ea',
  pcs: 'ea',
  unit: 'ea',
  units: 'ea',
  item: 'ea',
  items: 'ea',
};

export function lineItemUnitLabel(item, money) {
  const raw = String(item?.unit_type || item?.unit || item?.weight_unit || '')
    .trim()
    .replace(/\./g, '');
  const aliased = UNIT_ALIASES[raw.toLowerCase()];
  if (aliased) return aliased;
  if (raw) return raw;
  if (money?.grossQuantity) return 'g';
  return 'ea';
}

export function isWeightUnit(unit) {
  return ['g', 'oz', 'dwt', 'kg', 'lb'].includes(String(unit || '').toLowerCase());
}

export function stripUnitSuffix(value) {
  return String(value || '')
    .replace(/\/\s*[A-Za-z]+\s*$/, '')
    .trim();
}

export function draftItemUnitType(item) {
  if (item?.unitType) return item.unitType;
  const cost = String(item?.unit?.original || item?.unit?.value || '');
  const match = cost.match(/\/\s*([A-Za-z]+)\s*$/);
  if (match) return UNIT_ALIASES[match[1].toLowerCase()] || match[1];
  return 'ea';
}

function paymentCurrencyCode(payment, entry) {
  const raw = payment?.currency ?? payment?.till?.currency ?? entry?.currency ?? 'CAD';
  const code = String(raw?.code || raw?.iso || raw?.name || raw || 'CAD')
    .trim()
    .toUpperCase();
  if (code === 'USD' || code === 'US' || code === 'US$' || /\bUS\s*DOLLAR/.test(code)) return 'USD';
  return 'CAD';
}

function paymentTillName(payment, entry) {
  const name = String(
    payment?.till?.name ||
      entry?.till?.name ||
      payment?.till_name ||
      payment?.cash_drawer?.name ||
      entry?.till_name ||
      '',
  ).trim();
  return name && name !== '—' ? name : '';
}

function paymentNotesText(payment, entry) {
  return String(
    payment?.comments ||
      payment?.notes ||
      payment?.note ||
      entry?.comments ||
      entry?.notes ||
      entry?.note ||
      '',
  ).trim();
}

export function normalizeDraft(draft) {
  if (!draft || typeof draft !== 'object') return draft;
  const items = Array.isArray(draft.items) ? draft.items : [];
  const payments = Array.isArray(draft.payments) ? draft.payments : [];
  return {
    ...draft,
    header: Array.isArray(draft.header) ? draft.header : [],
    items: items.map((item) => {
      const unitType = draftItemUnitType(item);
      return {
        ...item,
        unitType,
        imageUrls: Array.isArray(item.imageUrls) ? item.imageUrls : [],
        deliveredLabel: item.deliveredLabel || '',
        name: item.name || makeField(''),
        qty: item.qty || makeField(''),
        unit: item.unit
          ? {
              original: stripUnitSuffix(item.unit.original),
              value: stripUnitSuffix(item.unit.value),
            }
          : makeField(''),
        amount: item.amount || makeField(''),
      };
    }),
    payments: payments.map((payment) => ({
      ...payment,
      method: payment.method || makeField(''),
      till: payment.till || makeField(''),
      currency: payment.currency || makeField('CAD'),
      amount: payment.amount || makeField(''),
      notes: payment.notes || makeField(''),
    })),
  };
}

export function makeField(original) {
  const text = original == null ? '' : String(original);
  return { original: text, value: text };
}

export function fieldChanged(field) {
  return String(field?.value ?? '') !== String(field?.original ?? '');
}

export function clientDisplayName(detail, fallback) {
  const client = detail?.client;
  if (!client) return fallback || '';
  const name = [client.first_name, client.last_name].filter(Boolean).join(' ').trim();
  return name || client.nickname || fallback || '';
}

export function buildDraft(row, detail) {
  const items = Array.isArray(detail?.items) ? detail.items.filter(Boolean) : [];
  const payments = Array.isArray(detail?.payments) ? detail.payments.filter(Boolean) : [];
  const total = detail?.total_amount ?? row.amount;
  const fallbackItems =
    items.length > 0
      ? items
      : (row.itemNames || []).map((name, index) => ({
          id: `named-${index}`,
          description: name,
          price: '',
        }));

  return {
    header: [
      {
        key: 'customer',
        label: row.type === 'purchase' ? 'Vendor / customer' : 'Customer',
        ...makeField(clientDisplayName(detail, row.customerName)),
      },
      {
        key: 'store',
        label: 'Store',
        ...makeField(detail?.location?.name || row.storeName || ''),
      },
      {
        key: 'employee',
        label: 'Employee',
        ...makeField(row.employeeName || ''),
      },
      {
        key: 'date',
        label: 'Date',
        ...makeField(row.dateLabel || ''),
      },
      {
        key: 'total',
        label: 'Total',
        ...makeField(formatAmount(total)),
      },
    ],
    items: fallbackItems.map((item, index) => {
      const money = item.price === '' && !item.quantity ? null : lineItemMoney(item);
      const unitType = lineItemUnitLabel(item, money);
      const unitCost =
        money?.displayUnitPrice == null ? '' : formatAmount(money.displayUnitPrice);
      const amountLabel = money?.lineTotal == null ? '' : formatAmount(money.lineTotal);
      const itemImages = collectItemImageUrls(item);
      const recordImages = collectRecordImageUrls(detail);
      return {
        id: item.id || `item-${index}`,
        name: makeField(lineItemName(item)),
        qty: makeField(lineItemQty(item)),
        unit: makeField(unitCost),
        unitType,
        amount: makeField(amountLabel),
        deliveredLabel: deliveredQtyRatio(item),
        imageUrls: itemImages.length ? itemImages : recordImages,
      };
    }),
    payments: payments.map((entry, index) => {
      const payment = (entry && (entry.payment || entry)) || {};
      const currency = paymentCurrencyCode(payment, entry);
      return {
        id: entry.id || payment.id || `pay-${index}`,
        method: makeField(payment.payment_type?.name || 'Payment'),
        till: makeField(paymentTillName(payment, entry)),
        currency: makeField(currency),
        amount: makeField(formatAmount(entry.amount ?? payment.amount, currency)),
        notes: makeField(paymentNotesText(payment, entry)),
      };
    }),
  };
}

export function collectCorrections(draft) {
  const corrections = [];
  if (!draft) return corrections;

  for (const field of draft.header || []) {
    if (fieldChanged(field)) {
      corrections.push({
        key: field.key,
        label: field.label,
        original: field.original,
        value: field.value,
      });
    }
  }

  (draft.items || []).forEach((item, index) => {
    const label = `Item ${index + 1}`;
    if (fieldChanged(item.name)) {
      corrections.push({
        key: `${item.id}-name`,
        label: `${label} name`,
        original: item.name.original,
        value: item.name.value,
      });
    }
    if (fieldChanged(item.qty)) {
      corrections.push({
        key: `${item.id}-qty`,
        label: `${label} qty`,
        original: item.qty.original,
        value: item.qty.value,
      });
    }
    if (item.unit && fieldChanged(item.unit)) {
      corrections.push({
        key: `${item.id}-unit`,
        label: `${label} unit cost`,
        original: item.unit.original,
        value: item.unit.value,
      });
    }
    if (fieldChanged(item.amount)) {
      corrections.push({
        key: `${item.id}-amount`,
        label: `${label} amount`,
        original: item.amount.original,
        value: item.amount.value,
      });
    }
  });

  (draft.payments || []).forEach((payment, index) => {
    const label = `Payment ${index + 1}`;
    if (fieldChanged(payment.method)) {
      corrections.push({
        key: `${payment.id}-method`,
        label: `${label} method`,
        original: payment.method.original,
        value: payment.method.value,
      });
    }
    if (payment.till && fieldChanged(payment.till)) {
      corrections.push({
        key: `${payment.id}-till`,
        label: `${label} till`,
        original: payment.till.original,
        value: payment.till.value,
      });
    }
    if (payment.currency && fieldChanged(payment.currency)) {
      corrections.push({
        key: `${payment.id}-currency`,
        label: `${label} currency`,
        original: payment.currency.original,
        value: payment.currency.value,
      });
    }
    if (fieldChanged(payment.amount)) {
      corrections.push({
        key: `${payment.id}-amount`,
        label: `${label} amount`,
        original: payment.amount.original,
        value: payment.amount.value,
      });
    }
    if (payment.notes && fieldChanged(payment.notes)) {
      corrections.push({
        key: `${payment.id}-notes`,
        label: `${label} notes`,
        original: payment.notes.original,
        value: payment.notes.value,
      });
    }
  });

  return corrections;
}

export function formatErrorAmount(value) {
  const amount = String(value || '').trim();
  if (!amount) return '';
  if (amount.startsWith('$')) return amount;
  return formatAmount(Number(amount.replace(/[^0-9.-]/g, '')) || amount);
}

export function parseDraftAmount(value) {
  const amount = String(value || '').replace(/[^0-9.-]/g, '');
  if (!amount || amount === '-' || amount === '.' || amount === '-.') return 0;
  const n = Number(amount);
  return Number.isFinite(n) ? n : 0;
}

export function formatPaymentsTotal(payments) {
  const list = Array.isArray(payments) ? payments : [];
  if (!list.length) return formatAmount(0);
  const groups = new Map();
  for (const payment of list) {
    const code = String(payment?.currency?.value || 'CAD').trim().toUpperCase() === 'USD' ? 'USD' : 'CAD';
    groups.set(code, (groups.get(code) || 0) + parseDraftAmount(payment?.amount?.value));
  }
  return [...groups.entries()].map(([code, amount]) => formatAmount(amount, code)).join(' + ');
}

export function withSyncedHeaderTotal(draft) {
  if (!draft?.header) return draft;
  const payments = Array.isArray(draft.payments) ? draft.payments : [];
  if (!payments.length) return draft;
  const nextTotal = formatPaymentsTotal(payments);
  return {
    ...draft,
    header: draft.header.map((field) => (field.key === 'total' ? { ...field, value: nextTotal } : field)),
  };
}

function paymentCurrencyOf(payment) {
  return String(payment?.currency?.value || 'CAD').trim().toUpperCase() === 'USD' ? 'USD' : 'CAD';
}

export function draftDisplayCurrency(draft) {
  const payments = Array.isArray(draft?.payments) ? draft.payments : [];
  if (!payments.length) return 'CAD';
  const codes = payments.map(paymentCurrencyOf);
  if (codes.length && codes.every((code) => code === 'USD')) return 'USD';
  return 'CAD';
}

export function formatItemsTotal(items, currency = 'CAD') {
  const total = (items || []).reduce((sum, item) => sum + parseDraftAmount(item?.amount?.value), 0);
  return formatAmount(total, currency);
}

function withLineAmountFromQtyUnit(item, currency = 'CAD') {
  if (!item) return item;
  const nextAmount = formatAmount(
    parseDraftAmount(item?.qty?.value) * parseDraftAmount(item?.unit?.value),
    currency,
  );
  return {
    ...item,
    amount: { ...(item.amount || makeField('')), value: nextAmount },
  };
}

export function withPaymentsMatchingTotal(payments, nextTotalValue) {
  const list = Array.isArray(payments) ? payments : [];
  if (!list.length) return list;
  const nextTotal = parseDraftAmount(nextTotalValue);
  if (list.length === 1) {
    const currency = paymentCurrencyOf(list[0]);
    return [
      {
        ...list[0],
        amount: { ...(list[0].amount || makeField('')), value: formatAmount(nextTotal, currency) },
      },
    ];
  }
  const currentSum = list.reduce((sum, payment) => sum + parseDraftAmount(payment?.amount?.value), 0);
  if (!(currentSum > 0)) {
    return list.map((payment, index) => ({
      ...payment,
      amount: {
        ...(payment.amount || makeField('')),
        value: formatAmount(index === 0 ? nextTotal : 0, paymentCurrencyOf(payment)),
      },
    }));
  }
  let allocated = 0;
  return list.map((payment, index) => {
    const currency = paymentCurrencyOf(payment);
    if (index === list.length - 1) {
      return {
        ...payment,
        amount: {
          ...(payment.amount || makeField('')),
          value: formatAmount(nextTotal - allocated, currency),
        },
      };
    }
    const share = Math.round((parseDraftAmount(payment.amount?.value) / currentSum) * nextTotal * 100) / 100;
    allocated += share;
    return {
      ...payment,
      amount: { ...(payment.amount || makeField('')), value: formatAmount(share, currency) },
    };
  });
}

export function withSyncedTotalsFromItems(draft) {
  if (!draft) return draft;
  const currency = draftDisplayCurrency(draft);
  const nextTotal = formatItemsTotal(draft.items, currency);
  return {
    ...draft,
    header: Array.isArray(draft.header)
      ? draft.header.map((field) => (field.key === 'total' ? { ...field, value: nextTotal } : field))
      : draft.header,
    payments: withPaymentsMatchingTotal(draft.payments, nextTotal),
  };
}

export function withItemPartUpdated(draft, id, part, value) {
  if (!draft?.items) return draft;
  const currency = draftDisplayCurrency(draft);
  const items = draft.items.map((item) => {
    if (item.id !== id) return item;
    const next = { ...item, [part]: { ...(item[part] || makeField('')), value } };
    if (part === 'qty' || part === 'unit') return withLineAmountFromQtyUnit(next, currency);
    return next;
  });
  const next = { ...draft, items };
  if (part === 'qty' || part === 'unit' || part === 'amount') return withSyncedTotalsFromItems(next);
  return next;
}

export const MAX_REVIEW_IMAGES = 8;

export function normalizeReviewImages(images) {
  if (!Array.isArray(images)) return [];
  return images
    .map((item, index) => {
      const uri = typeof item === 'string' ? item : item?.uri;
      if (!uri) return null;
      return {
        id: String(item?.id || `img-${index}`),
        uri,
      };
    })
    .filter(Boolean)
    .slice(0, MAX_REVIEW_IMAGES);
}

export function buildReview(row, draft, { note = '', errorType = '', errorAmount = '', images = [] } = {}) {
  return {
    draft,
    corrections: collectCorrections(draft),
    note: String(note || '').trim(),
    errorType: String(errorType || '').trim(),
    errorAmount: formatErrorAmount(errorAmount),
    images: normalizeReviewImages(images),
  };
}
