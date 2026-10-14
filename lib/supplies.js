import { canonicalStoreName } from './storeCatalog';
import { getSupabase } from './supabase';

export const SUPPLY_STATUSES = [
  { key: 'in_stock', label: 'In Stock', color: '#15803D', tint: '#ECFDF5' },
  { key: 'low', label: 'Low', color: '#B45309', tint: '#FEF3C7' },
  { key: 'out', label: 'Out', color: '#B91C1C', tint: '#FEE2E2' },
  { key: 'ordered', label: 'Ordered', color: '#1D4ED8', tint: '#EFF6FF' },
];

const STATUS_KEYS = new Set(SUPPLY_STATUSES.map((item) => item.key));
const COLUMNS =
  'id, name, brand, details, bought_from, current_quantity, status, last_bought_date, last_bought_quantity, store_name, created_at, updated_at';

function asString(value) {
  return String(value ?? '').trim();
}

function asQuantity(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100) / 100;
}

function asDate(value) {
  const text = asString(value);
  if (!text) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
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
    status: STATUS_KEYS.has(row.status) ? row.status : 'in_stock',
    lastBoughtDate: row.last_bought_date || '',
    storeName: canonicalStoreName(row.store_name) || row.store_name || '',
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

export function supplyStatusMeta(status) {
  return SUPPLY_STATUSES.find((item) => item.key === status) || SUPPLY_STATUSES[0];
}

export function supplyStatusLabel(status) {
  return supplyStatusMeta(status).label;
}

export function formatSupplyQty(value) {
  if (value == null || value === '') return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return Number.isInteger(n) ? String(n) : String(n);
}

function friendlyError(error) {
  return error?.message || 'Could not save that supply.';
}

function persistStoreName(value) {
  return canonicalStoreName(value) || asString(value);
}

export async function listSupplies(storeName) {
  const supabase = getSupabase();
  let query = supabase
    .from('supply_items')
    .select(COLUMNS)
    .order('store_name', { ascending: true })
    .order('name', { ascending: true });
  const store = persistStoreName(storeName);
  if (store) query = query.eq('store_name', store);
  const { data, error } = await query;
  if (error) throw new Error(friendlyError(error));
  return (data || []).map(mapRow).filter(Boolean);
}

export async function createSupply(input) {
  const name = asString(input?.name);
  if (!name) throw new Error('Name the supply first.');
  const currentQuantity = asQuantity(input?.currentQuantity);
  if (currentQuantity == null) throw new Error('Enter a current quantity.');
  const status = STATUS_KEYS.has(input?.status) ? input.status : 'in_stock';
  const storeNames = (Array.isArray(input?.storeNames) ? input.storeNames : [input?.storeName])
    .map(persistStoreName)
    .filter(Boolean);
  if (!storeNames.length) throw new Error('Choose a store, or All stores.');

  const payload = storeNames.map((store) => ({
    name,
    brand: asString(input?.brand),
    details: asString(input?.details),
    bought_from: asString(input?.boughtFrom),
    current_quantity: currentQuantity,
    status,
    last_bought_date: asDate(input?.lastBoughtDate),
    last_bought_quantity: null,
    store_name: store,
  }));

  const { data, error } = await getSupabase().from('supply_items').insert(payload).select(COLUMNS);
  if (error) throw new Error(friendlyError(error));
  return (data || []).map(mapRow).filter(Boolean);
}

export async function updateSupply(id, input) {
  if (!id) throw new Error('Missing supply.');
  const name = asString(input?.name);
  if (!name) throw new Error('Name the supply first.');
  const currentQuantity = asQuantity(input?.currentQuantity);
  if (currentQuantity == null) throw new Error('Enter a current quantity.');
  const status = STATUS_KEYS.has(input?.status) ? input.status : 'in_stock';
  const { data, error } = await getSupabase()
    .from('supply_items')
    .update({
      name,
      brand: asString(input?.brand),
      details: asString(input?.details),
      bought_from: asString(input?.boughtFrom),
      current_quantity: currentQuantity,
      status,
      last_bought_date: asDate(input?.lastBoughtDate),
      last_bought_quantity: null,
      store_name: persistStoreName(input?.storeName),
    })
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
