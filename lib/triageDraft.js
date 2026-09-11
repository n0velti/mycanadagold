import { formatAmount, formatUnitCost, lineItemMoney } from './transactions';

export const ERROR_TYPES = [
  'Wrong item',
  'Wrong quantity',
  'Wrong price',
  'Wrong customer',
  'Wrong payment',
  'Missing item',
  'Other',
];

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

  if (candidates.length) return candidates[0];
  if (product?.metal?.name) {
    return product?.type === 'scrap' ? `Scrap ${product.metal.name}` : product.metal.name;
  }
  return 'Untitled item';
}

export function lineItemQty(item) {
  const qty = item?.quantity ?? item?.gross_quantity ?? 1;
  return String(qty);
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
      const unitType = item?.unit_type || (money?.grossQuantity ? 'g' : '');
      const unitLabel = money ? formatUnitCost(money.displayUnitPrice, unitType) : '';
      const amountLabel = money?.lineTotal == null ? '' : formatAmount(money.lineTotal);
      return {
        id: item.id || `item-${index}`,
        name: makeField(lineItemName(item)),
        qty: makeField(lineItemQty(item)),
        unit: makeField(unitLabel),
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
        label: `${label} unit`,
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
