/**
 * Every label on a POS ticket, defined once. The Aureus orders and purchases
 * records (East, GTA, PMX) carry more than the amount: how it was paid, the
 * currency, where it came from, delivery, item and bookkeeping status, the
 * customer's type, tags, and the till. Each entry here turns one of those
 * fields into a dimension the assistants can group, split, or filter by, so
 * a "breakdown by X" never needs a new tool — only a new entry here.
 *
 * `valueOf(row, place)` reads a transaction row (lib/transactions.js) and
 * returns one label, or a list for multi-valued fields (tags, tills), where a
 * ticket counts once under each value. `place` is the customer's home address
 * when the caller looked it up; otherwise the row's own city / postal fields.
 */
import { PAYMENT_METHOD_UNRECORDED, paymentMethodGroup } from '../transactions';

export const LABEL_NOT_RECORDED = 'Not recorded';

function titleCase(value) {
  return String(value || '')
    .trim()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\b[a-z]/g, (char) => char.toUpperCase());
}

function sourceLabel(row) {
  if (row?.type === 'purchase') return row.websiteCreated ? 'Website' : 'In store';
  const raw = String(row?.source || '').trim().toLowerCase();
  if (!raw || raw === 'in_person' || raw === 'in person' || raw === 'pos') return 'In store';
  if (raw === 'site' || raw === 'website' || raw === 'web') return 'Website';
  if (raw === 'ebay') return 'eBay';
  return titleCase(raw);
}

function deliveryLabel(row) {
  if (row?.type !== 'order') return 'Not applicable';
  const raw = String(row?.deliveryMode || '').trim().toLowerCase();
  if (!raw) return LABEL_NOT_RECORDED;
  if (raw === 'ship' || raw === 'shipping') return 'Ship';
  if (raw === 'person' || raw === 'in_person' || raw === 'pickup') return 'In person';
  return titleCase(raw);
}

function postalArea(place, row) {
  const postal = String(place?.postal || row?.customerPostal || '')
    .toUpperCase()
    .replace(/\s+/g, '');
  return postal ? postal.slice(0, 3) : '';
}

export const TICKET_LABELS = {
  paymentMethod: {
    label: 'Payment method',
    description:
      'How the ticket was paid, from its POS record: Cash, Debit, Interac e-transfer, Credit Card, Personal / Business Cheque, Bank Wire. A ticket paid two ways is one value with both names ("Cash + Debit") and its dollars stay together.',
    examples: '"cash", "debit", "e-transfer"',
    empty: PAYMENT_METHOD_UNRECORDED,
    valueOf: (row) => paymentMethodGroup(row),
  },
  currency: {
    label: 'Currency',
    description: 'CAD or USD on the ticket (Richmond Hill bullion tickets are often USD).',
    examples: '"USD"',
    valueOf: (row) => String(row?.currency || 'CAD').trim().toUpperCase() || 'CAD',
  },
  source: {
    label: 'Source',
    description:
      'Where the ticket came from: Website (an online order, or a web purchase the site created), In store, eBay, Whatnot, Walmart.',
    examples: '"website", "in store"',
    valueOf: sourceLabel,
  },
  deliveryMode: {
    label: 'Delivery',
    description: 'Sales only: Ship (sent to the customer) or In person (picked up or over the counter). Purchases are Not applicable.',
    examples: '"ship", "in person"',
    valueOf: deliveryLabel,
  },
  itemStatus: {
    label: 'Item status',
    description:
      'The POS item status: Received (a purchase taken into stock), Pending (a sale not yet delivered), Sent (a sale delivered).',
    examples: '"pending", "sent", "received"',
    empty: LABEL_NOT_RECORDED,
    valueOf: (row) => titleCase(row?.itemStatus) || LABEL_NOT_RECORDED,
  },
  paidStatus: {
    label: 'Bookkeeping status',
    description:
      'The POS bookkeeping (allocation) status: Paid, Not paid, To be received (payment expected), Partially paid.',
    examples: '"paid", "not paid", "to be received"',
    empty: LABEL_NOT_RECORDED,
    // The POS writes these as sentences ("To be received"); keep that casing.
    valueOf: (row) => {
      const raw = String(row?.paidStatus || '').trim().replace(/\s+/g, ' ');
      return raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : LABEL_NOT_RECORDED;
    },
  },
  clientType: {
    label: 'Customer type',
    description: 'Person or Company, from the customer record on the ticket.',
    examples: '"company"',
    empty: LABEL_NOT_RECORDED,
    valueOf: (row) => titleCase(row?.clientType) || LABEL_NOT_RECORDED,
  },
  till: {
    label: 'Till',
    description:
      'The cash till(s) the ticket\'s payments went through (1-1, 2-1, 2-2). Tickets with no cash payment have no till. A ticket on two tills counts under each.',
    examples: '"2-1"',
    empty: 'No till',
    multi: true,
    valueOf: (row) => (Array.isArray(row?.tills) && row.tills.length ? row.tills : ['No till']),
  },
  productTag: {
    label: 'Product tag',
    description:
      'Tags on the products sold or bought (2026 maple, fractional, …). A ticket whose items carry two tags counts under each, so tag rows can add up to more than the ticket total.',
    examples: '"2026 maple", "fractional"',
    empty: 'No tag',
    multi: true,
    valueOf: (row) => (Array.isArray(row?.productTags) && row.productTags.length ? row.productTags : ['No tag']),
  },
  transactionTag: {
    label: 'Transaction tag',
    description: 'Tags staff put on the ticket itself. A ticket with two tags counts under each.',
    examples: '"estate"',
    empty: 'No tag',
    multi: true,
    valueOf: (row) =>
      Array.isArray(row?.transactionTags) && row.transactionTags.length ? row.transactionTags : ['No tag'],
  },
  system: {
    label: 'POS system',
    description: 'Which Aureus tenant holds the ticket: Canada Gold East, Canada Gold GTA, or Canadian PMX (Richmond Hill).',
    examples: '"PMX", "GTA"',
    valueOf: (row) => String(row?.systemLabel || row?.systemKey || '').trim() || 'Unknown',
  },
  city: {
    label: 'Customer city',
    description: 'The home city on the customer\'s POS record (the same address the customer map uses).',
    empty: 'No address on file',
    needsPlaces: true,
    filterable: false,
    valueOf: (row, place) => String(place?.city || row?.customerCity || '').trim() || 'No address on file',
  },
  postalArea: {
    label: 'Postal area',
    description: 'The forward sortation area (first three characters) of the customer\'s home postal code, such as H3C or L4C.',
    empty: 'No address on file',
    needsPlaces: true,
    filterable: false,
    valueOf: (row, place) => postalArea(place, row) || 'No address on file',
  },
};

export const TICKET_LABEL_KEYS = Object.keys(TICKET_LABELS);

/** Labels the model may narrow by with words; city and postal have their own filters. */
export const TICKET_FILTER_LABEL_KEYS = TICKET_LABEL_KEYS.filter((key) => TICKET_LABELS[key].filterable !== false);

export const TICKET_LABELS_NEEDING_PLACES = new Set(TICKET_LABEL_KEYS.filter((key) => TICKET_LABELS[key].needsPlaces));

export function isTicketLabel(key) {
  return Object.prototype.hasOwnProperty.call(TICKET_LABELS, String(key || ''));
}

export function ticketLabelMeta(key) {
  return TICKET_LABELS[String(key || '')] || null;
}

/** The label(s) of one ticket along one dimension; always a non-empty list. */
export function ticketLabelValues(row, key, place = null) {
  const meta = ticketLabelMeta(key);
  if (!meta) return [];
  const value = meta.valueOf(row, place);
  const list = (Array.isArray(value) ? value : [value]).map((item) => String(item ?? '').trim()).filter(Boolean);
  return list.length ? list : [meta.empty || LABEL_NOT_RECORDED];
}

/** Filter properties for the tool schemas: one per label, "value contains these words". */
export function ticketLabelFilterProperties() {
  const out = {};
  for (const key of TICKET_FILTER_LABEL_KEYS) {
    const meta = TICKET_LABELS[key];
    out[key] = {
      type: 'string',
      description: `${meta.label}: keep tickets whose ${meta.label.toLowerCase()} contains these words${meta.examples ? `, such as ${meta.examples}` : ''}. For a breakdown across values use groupBy ${key} instead.`,
    };
  }
  return out;
}

/** One line per label, for the model. */
export function ticketLabelCatalogText() {
  return TICKET_LABEL_KEYS.map((key) => `${key} (${TICKET_LABELS[key].label}): ${TICKET_LABELS[key].description}`).join('\n');
}

/** Caveats worth a sentence after grouping by this label. */
export function ticketLabelNote(key, countByValue) {
  const meta = ticketLabelMeta(key);
  if (!meta) return '';
  const parts = [];
  if (meta.multi) {
    parts.push(
      `${meta.label} is multi-valued: a ticket with two values counts once under each, so the rows can add up to more than the ticket total.`,
    );
  }
  if (key === 'paymentMethod') {
    parts.push('A ticket paid two ways is its own row labelled with both methods and its dollars stay together.');
  }
  const empty = meta.empty ? Number(countByValue?.get?.(meta.empty) ?? countByValue?.[meta.empty] ?? 0) : 0;
  if (empty) {
    parts.push(
      `"${meta.empty}" is ${empty} ${empty === 1 ? 'ticket' : 'tickets'} with no ${meta.label.toLowerCase()} on the record; mention it.`,
    );
  }
  return parts.join(' ');
}
