import { formatAmount, lineItemMoney } from './transactions';

export const ERROR_TYPES = [
  'Wrong item',
  'Wrong quantity',
  'Wrong price',
  'Wrong customer',
  'Wrong payment',
  'Missing item',
  'Other',
];

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

export function normalizeDraft(draft) {
  if (!draft) return draft;
  return {
    ...draft,
    items: (draft.items || []).map((item) => {
      const unitType = draftItemUnitType(item);
      return {
        ...item,
        unitType,
        unit: item.unit
          ? {
              original: stripUnitSuffix(item.unit.original),
              value: stripUnitSuffix(item.unit.value),
            }
          : item.unit,
      };
    }),
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
  const items = Array.isArray(detail?.items) ? detail.items : [];
  const payments = Array.isArray(detail?.payments) ? detail.payments : [];
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
      return {
        id: item.id || `item-${index}`,
        name: makeField(lineItemName(item)),
        qty: makeField(lineItemQty(item)),
        unit: makeField(unitCost),
        unitType,
        amount: makeField(amountLabel),
      };
    }),
    payments: payments.map((entry, index) => {
      const payment = entry.payment || entry;
      return {
        id: entry.id || payment.id || `pay-${index}`,
        method: makeField(payment.payment_type?.name || 'Payment'),
        amount: makeField(formatAmount(entry.amount ?? payment.amount)),
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
    if (fieldChanged(payment.amount)) {
      corrections.push({
        key: `${payment.id}-amount`,
        label: `${label} amount`,
        original: payment.amount.original,
        value: payment.amount.value,
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
