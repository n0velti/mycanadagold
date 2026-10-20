import { canonicalStoreName } from './storeCatalog';
import { getSupabase } from './supabase';
import { formatDateParam, formatPickerDate, parseDateParam } from './transactions';

export const SUPPLY_ORDER_MORE = [
  { key: 'no', label: 'N', title: 'No', color: '#34C759', tint: '#E8F8EC' },
  { key: 'yes_nu', label: 'Y · NU', title: 'Yes, not urgent', color: '#FF9F0A', tint: '#FFF4E0' },
  { key: 'yes', label: 'Y', title: 'Yes', color: '#FF3B30', tint: '#FFECEC' },
];

const ORDER_KEYS = new Set(SUPPLY_ORDER_MORE.map((item) => item.key));

export const SUPPLY_CATEGORIES = [
  {
    key: 'acids',
    label: 'Acids',
    hint: 'Update every time a new bottle is opened.',
  },
  {
    key: 'cleaning',
    label: 'Cleaning supplies',
  },
  {
    key: 'office',
    label: 'Office supplies',
  },
  {
    key: 'shipping',
    label: 'Shipping supplies',
  },
  {
    key: 'cheques',
    label: 'Cheques',
  },
  {
    key: 'other',
    label: 'Other',
  },
];

/** Branch Manager template tab — one row per item, copied per store. */
export const SUPPLY_TEMPLATE = [
  { key: 'acids-10k', category: 'acids', name: '10k', sort: 10 },
  { key: 'acids-14k', category: 'acids', name: '14k', sort: 20 },
  { key: 'acids-18k', category: 'acids', name: '18k', sort: 30 },
  { key: 'acids-22k', category: 'acids', name: '22k', sort: 40 },
  { key: 'acids-platinum', category: 'acids', name: 'Platinum', sort: 50 },
  { key: 'acids-silver', category: 'acids', name: 'Silver', sort: 60 },
  { key: 'cleaning-mop-heads', category: 'cleaning', name: 'Mop heads', sort: 10 },
  { key: 'cleaning-paper-towel', category: 'cleaning', name: 'Paper towel rolls', sort: 20 },
  { key: 'cleaning-toilet-paper', category: 'cleaning', name: 'Toilet paper', sort: 30 },
  { key: 'cleaning-air-freshener', category: 'cleaning', name: 'Air freshener', sort: 40 },
  { key: 'cleaning-hand-sanitizer', category: 'cleaning', name: 'Hand sanitizer', sort: 50 },
  { key: 'cleaning-lysol-wipes', category: 'cleaning', name: 'Lysol wipes', sort: 60 },
  { key: 'cleaning-lysol-spray', category: 'cleaning', name: 'Lysol spray', sort: 70 },
  { key: 'cleaning-tissue', category: 'cleaning', name: 'Tissue boxes', sort: 80 },
  { key: 'cleaning-garbage-bags', category: 'cleaning', name: 'Garbage bags', sort: 90 },
  { key: 'cleaning-recycling-bags', category: 'cleaning', name: 'Recycling bags', sort: 100 },
  { key: 'cleaning-pinesol', category: 'cleaning', name: 'Pinesol', sort: 110 },
  { key: 'office-printer-ink', category: 'office', name: 'Printer ink', sort: 10 },
  { key: 'office-pens', category: 'office', name: 'Pens', sort: 20 },
  { key: 'office-paper-reams', category: 'office', name: 'Paper reams', sort: 30 },
  { key: 'office-receipt-books', category: 'office', name: 'Receipt books', sort: 40 },
  { key: 'office-tape', category: 'office', name: 'Tape', sort: 50 },
  { key: 'office-staples', category: 'office', name: 'Staples', sort: 60 },
  { key: 'office-business-cards', category: 'office', name: 'Business cards', sort: 70 },
  { key: 'office-review-cards', category: 'office', name: 'Review cards', sort: 80 },
  { key: 'office-large-gloves', category: 'office', name: 'Large gloves', sort: 90 },
  { key: 'office-medium-gloves', category: 'office', name: 'Medium gloves', sort: 100 },
  { key: 'office-daily-bags', category: 'office', name: 'Daily purchase bags', sort: 110 },
  { key: 'office-individual-bags', category: 'office', name: 'Individual purchase bags', sort: 120 },
  { key: 'office-tiny-bags', category: 'office', name: 'Tiny bags for individual bullion', sort: 130 },
  { key: 'shipping-ups-large', category: 'shipping', name: 'UPS boxes large', sort: 10 },
  { key: 'shipping-ups-medium', category: 'shipping', name: 'UPS boxes medium', sort: 20 },
  { key: 'shipping-uline', category: 'shipping', name: 'ULINE boxes', sort: 30 },
  { key: 'shipping-clear-tape', category: 'shipping', name: 'Clear packing tape', sort: 40 },
  { key: 'shipping-duct-tape', category: 'shipping', name: 'Duct tape', sort: 50 },
  { key: 'shipping-brinks-bags', category: 'shipping', name: 'Brinks bags', sort: 60 },
  { key: 'shipping-brinks-slips', category: 'shipping', name: 'Brinks shipping slip covers', sort: 70 },
  { key: 'shipping-brinks-zipties', category: 'shipping', name: 'Brinks zip ties', sort: 80 },
  { key: 'cheques-in-use', category: 'cheques', name: 'In use', sort: 10 },
  { key: 'cheques-in-storage', category: 'cheques', name: 'In storage', sort: 20 },
];

const COLUMNS =
  'id, name, brand, details, bought_from, current_quantity, status, last_bought_date, last_bought_quantity, store_name, catalog_key, category, in_use, unopened, order_more, notes, sort_order, created_at, updated_at';

function asString(value, max = 0) {
  const text = String(value ?? '').trim();
  if (!max) return text;
  return text.slice(0, max);
}

function asOrderMore(value) {
  return ORDER_KEYS.has(value) ? value : 'no';
}

export function sectionKeyFromLabel(label) {
  const slug = asString(label)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug || 'section';
}

function asCategory(value) {
  const text = asString(value, 80);
  if (!text) return 'other';
  return text;
}

function persistStoreName(value) {
  return canonicalStoreName(value) || asString(value);
}

function mapRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name || '',
    brand: row.brand || '',
    details: row.details || '',
    boughtFrom: row.bought_from || '',
    currentQuantity: Number(row.current_quantity) || 0,
    status: row.status || 'in_stock',
    lastBoughtDate: row.last_bought_date || '',
    storeName: canonicalStoreName(row.store_name) || row.store_name || '',
    catalogKey: row.catalog_key || '',
    category: asCategory(row.category),
    inUse: row.in_use || '',
    unopened: row.unopened || '',
    orderMore: asOrderMore(row.order_more),
    notes: row.notes || '',
    sortOrder: Number(row.sort_order) || 0,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    isTemplate: Boolean(row.catalog_key),
  };
}

export function supplyOrderMeta(value) {
  return SUPPLY_ORDER_MORE.find((item) => item.key === value) || SUPPLY_ORDER_MORE[0];
}

export function supplyCategoryMeta(value, extras = []) {
  const key = asCategory(value);
  return (
    SUPPLY_CATEGORIES.find((item) => item.key === key) ||
    extras.find((item) => item.key === key) || {
      key,
      label: key,
    }
  );
}

export function cycleOrderMore(value) {
  const index = SUPPLY_ORDER_MORE.findIndex((item) => item.key === value);
  return SUPPLY_ORDER_MORE[(index + 1) % SUPPLY_ORDER_MORE.length].key;
}

export function groupSupplies(rows, extraSections = []) {
  const catalog = [];
  const seen = new Set();
  for (const item of [...SUPPLY_CATEGORIES, ...(extraSections || [])]) {
    if (!item?.key || seen.has(item.key)) continue;
    seen.add(item.key);
    catalog.push({ key: item.key, label: item.label || item.key, hint: item.hint || '' });
  }
  for (const row of rows || []) {
    const key = asCategory(row.category);
    if (seen.has(key)) continue;
    seen.add(key);
    catalog.push({ key, label: key, hint: '' });
  }

  const byCategory = new Map(catalog.map((item) => [item.key, []]));
  for (const row of rows || []) {
    const key = asCategory(row.category);
    if (!byCategory.has(key)) byCategory.set(key, []);
    byCategory.get(key).push(row);
  }
  for (const list of byCategory.values()) {
    list.sort((a, b) => {
      const sort = (a.sortOrder || 0) - (b.sortOrder || 0);
      if (sort) return sort;
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });
  }
  return catalog
    .map((meta) => ({
      ...meta,
      rows: byCategory.get(meta.key) || [],
    }))
    .filter((section) => section.rows.length > 0 || section.key !== 'other');
}

function friendlyError(error) {
  return error?.message || 'Could not save that supply.';
}

function templatePayload(storeName, item) {
  return {
    name: item.name,
    brand: '',
    details: '',
    bought_from: '',
    current_quantity: 0,
    status: 'in_stock',
    last_bought_date: null,
    last_bought_quantity: null,
    store_name: storeName,
    catalog_key: item.key,
    category: item.category,
    in_use: '',
    unopened: '',
    order_more: 'no',
    notes: '',
    sort_order: item.sort,
  };
}

export async function listSupplies(storeName) {
  const store = persistStoreName(storeName);
  if (!store) return [];
  const { data, error } = await getSupabase()
    .from('supply_items')
    .select(COLUMNS)
    .eq('store_name', store)
    .order('category', { ascending: true })
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });
  if (error) throw new Error(friendlyError(error));
  return (data || []).map(mapRow).filter(Boolean);
}

export async function ensureStoreSupplies(storeName) {
  const store = persistStoreName(storeName);
  if (!store) throw new Error('Choose a store.');
  const existing = await listSupplies(store);
  const have = new Set(existing.map((row) => row.catalogKey).filter(Boolean));
  const missing = SUPPLY_TEMPLATE.filter((item) => !have.has(item.key));
  if (!missing.length) return existing;

  const { error } = await getSupabase()
    .from('supply_items')
    .insert(missing.map((item) => templatePayload(store, item)));
  if (error && !/duplicate|unique|23505/i.test(`${error.code || ''} ${error.message || ''}`)) {
    throw new Error(friendlyError(error));
  }
  return listSupplies(store);
}

export async function createSupply(input) {
  const name = asString(input?.name, 120);
  if (!name) throw new Error('Name the supply first.');
  const store = persistStoreName(input?.storeName);
  if (!store) throw new Error('Choose a store.');
  const category = asCategory(input?.category);
  const sortOrder = Number.isFinite(Number(input?.sortOrder)) ? Number(input.sortOrder) : 1000;

  const { data, error } = await getSupabase()
    .from('supply_items')
    .insert({
      name,
      brand: asString(input?.brand, 80),
      details: asString(input?.details, 500),
      bought_from: asString(input?.boughtFrom, 120),
      current_quantity: 0,
      status: 'in_stock',
      last_bought_date: null,
      last_bought_quantity: null,
      store_name: store,
      catalog_key: null,
      category,
      in_use: asString(input?.inUse, 40),
      unopened: asString(input?.unopened, 40),
      order_more: asOrderMore(input?.orderMore),
      notes: asString(input?.notes, 500),
      sort_order: sortOrder,
    })
    .select(COLUMNS)
    .single();
  if (error) throw new Error(friendlyError(error));
  return mapRow(data);
}

const SECTION_COLUMNS = 'id, store_name, section_key, label, sort_order, created_at, updated_at';

function mapSection(row) {
  if (!row) return null;
  return {
    id: row.id,
    storeName: canonicalStoreName(row.store_name) || row.store_name || '',
    key: row.section_key,
    label: row.label || row.section_key,
    sortOrder: Number(row.sort_order) || 0,
  };
}

export async function listSupplySections(storeName) {
  const store = persistStoreName(storeName);
  if (!store) return [];
  const { data, error } = await getSupabase()
    .from('supply_sections')
    .select(SECTION_COLUMNS)
    .eq('store_name', store)
    .order('sort_order', { ascending: true })
    .order('label', { ascending: true });
  if (error) throw new Error(error?.message || 'Could not load sections.');
  return (data || []).map(mapSection).filter(Boolean);
}

export async function createSupplySection(storeName, label, existingKeys = []) {
  const store = persistStoreName(storeName);
  if (!store) throw new Error('Choose a store.');
  const name = asString(label, 80);
  if (!name) throw new Error('Name the section first.');
  const taken = new Set([
    ...SUPPLY_CATEGORIES.map((item) => item.key),
    ...existingKeys.map((key) => asString(key)),
  ]);
  let key = sectionKeyFromLabel(name);
  if (taken.has(key)) {
    let n = 2;
    while (taken.has(`${key}-${n}`)) n += 1;
    key = `${key}-${n}`;
  }
  const { data, error } = await getSupabase()
    .from('supply_sections')
    .insert({
      store_name: store,
      section_key: key,
      label: name,
      sort_order: 1000 + taken.size,
    })
    .select(SECTION_COLUMNS)
    .single();
  if (error) throw new Error(error?.message || 'Could not add that section.');
  return mapSection(data);
}

function writePatch(input) {
  const patch = {};
  if (input.name != null) patch.name = asString(input.name, 120);
  if (input.brand != null) patch.brand = asString(input.brand, 80);
  if (input.details != null) patch.details = asString(input.details, 500);
  if (input.boughtFrom != null) patch.bought_from = asString(input.boughtFrom, 120);
  if (input.storeName != null) patch.store_name = persistStoreName(input.storeName);
  if (input.category != null) patch.category = asCategory(input.category);
  if (input.inUse != null) patch.in_use = asString(input.inUse, 40);
  if (input.unopened != null) patch.unopened = asString(input.unopened, 40);
  if (input.orderMore != null) patch.order_more = asOrderMore(input.orderMore);
  if (input.notes != null) patch.notes = asString(input.notes, 500);
  if (input.sortOrder != null) patch.sort_order = Number(input.sortOrder) || 0;
  return patch;
}

export async function updateSupply(id, input) {
  if (!id) throw new Error('Missing supply.');
  const patch = writePatch(input);
  if (patch.name === '') throw new Error('Name the supply first.');
  if (!Object.keys(patch).length) throw new Error('Nothing to update.');
  const { data, error } = await getSupabase()
    .from('supply_items')
    .update(patch)
    .eq('id', id)
    .select(COLUMNS)
    .single();
  if (error) throw new Error(friendlyError(error));
  return mapRow(data);
}

export async function deleteSupply(id) {
  if (!id) throw new Error('Missing supply.');
  const { error } = await getSupabase().from('supply_items').delete().eq('id', id);
  if (error) throw new Error(friendlyError(error));
}

const AUDIT_COLUMNS = 'id, store_name, audit_date, items, created_by, created_at, updated_at';

function snapshotItems(rows) {
  return (rows || []).map((row, index) => ({
    catalogKey: row.catalogKey || '',
    category: asCategory(row.category),
    name: asString(row.name, 120),
    inUse: asString(row.inUse, 40),
    unopened: asString(row.unopened, 40),
    orderMore: asOrderMore(row.orderMore),
    notes: asString(row.notes, 500),
    sortOrder: Number(row.sortOrder) || index,
    isTemplate: Boolean(row.isTemplate || row.catalogKey),
  }));
}

function rowsFromSnapshot(items, storeName) {
  return (Array.isArray(items) ? items : []).map((item, index) => ({
    id: `${item.catalogKey || 'custom'}-${index}`,
    name: item.name || '',
    brand: '',
    details: '',
    boughtFrom: '',
    currentQuantity: 0,
    status: 'in_stock',
    lastBoughtDate: '',
    storeName,
    catalogKey: item.catalogKey || '',
    category: asCategory(item.category),
    inUse: item.inUse || '',
    unopened: item.unopened || '',
    orderMore: asOrderMore(item.orderMore),
    notes: item.notes || '',
    sortOrder: Number(item.sortOrder) || index,
    createdAt: null,
    updatedAt: null,
    isTemplate: Boolean(item.isTemplate || item.catalogKey),
  }));
}

function mapAudit(row) {
  if (!row) return null;
  const storeName = canonicalStoreName(row.store_name) || row.store_name || '';
  const auditDate = row.audit_date || '';
  return {
    id: row.id,
    storeName,
    auditDate,
    label: auditDate ? formatPickerDate(parseDateParam(auditDate)) : '',
    items: rowsFromSnapshot(row.items, storeName),
    createdBy: row.created_by || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

export async function listSupplyAudits(storeName) {
  const store = persistStoreName(storeName);
  if (!store) return [];
  const { data, error } = await getSupabase()
    .from('supply_audits')
    .select(AUDIT_COLUMNS)
    .eq('store_name', store)
    .order('audit_date', { ascending: false });
  if (error) throw new Error(error?.message || 'Could not load saved audits.');
  return (data || []).map(mapAudit).filter(Boolean);
}

export async function saveSupplyAudit(storeName, rows, auditDate) {
  const store = persistStoreName(storeName);
  if (!store) throw new Error('Choose a store.');
  const date = formatDateParam(auditDate || new Date());
  const payload = {
    store_name: store,
    audit_date: date,
    items: snapshotItems(rows),
  };
  const { data, error } = await getSupabase()
    .from('supply_audits')
    .upsert(payload, { onConflict: 'store_name,audit_date' })
    .select(AUDIT_COLUMNS)
    .single();
  if (error) throw new Error(error?.message || 'Could not save that audit.');
  return mapAudit(data);
}

/** @deprecated Kept so older callers still compile; template uses order-more. */
export const SUPPLY_STATUSES = [
  { key: 'in_stock', label: 'In Stock', color: '#15803D', tint: '#ECFDF5' },
  { key: 'low', label: 'Low', color: '#B45309', tint: '#FEF3C7' },
  { key: 'out', label: 'Out', color: '#B91C1C', tint: '#FEE2E2' },
  { key: 'ordered', label: 'Ordered', color: '#1D4ED8', tint: '#EFF6FF' },
];

export function supplyStatusMeta(status) {
  return SUPPLY_STATUSES.find((item) => item.key === status) || SUPPLY_STATUSES[0];
}

export function formatSupplyQty(value) {
  const text = asString(value);
  return text || '—';
}
