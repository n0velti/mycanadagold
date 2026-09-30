import { isExcludedCustomerName, isInventoryAdjustmentTicket } from './transactions';

function storeKey(name) {
  return String(name || '')
    .trim()
    .toLowerCase();
}

export function storesMatch(left, right) {
  const a = storeKey(left);
  const b = storeKey(right);
  return Boolean(a && b && a === b);
}

function personKey(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function stamp(value) {
  const text = String(value || '').trim();
  if (!text) return 0;
  const ms = Date.parse(text.includes('T') ? text : text.replace(' ', 'T'));
  return Number.isFinite(ms) ? ms : 0;
}

function customerKey(row) {
  const id = String(row?.customerId || '').trim();
  const system = String(row?.systemKey || '').trim();
  if (id) return `${system}:${id}`;
  return `${system}:name:${personKey(row?.customerName)}`;
}

/** Named customers ranked by visit count or ticket volume for a store or all stores. */
export function rankCustomers(rows, { storeName = '', sort = 'count', limit = 50 } = {}) {
  const wanted = String(storeName || '').trim();
  const byCustomer = new Map();

  for (const row of rows || []) {
    const name = String(row?.customerName || '').trim();
    if (!name || name === '—' || isExcludedCustomerName(name) || isInventoryAdjustmentTicket(row)) continue;
    if (wanted && !storesMatch(row.storeName, wanted)) continue;

    const key = customerKey(row);
    let entry = byCustomer.get(key);
    if (!entry) {
      entry = {
        id: row.customerId || '',
        label: name,
        systemKey: row.systemKey || '',
        systemLabel: row.systemLabel || '',
        token: row.token || '',
        baseUrl: row.baseUrl || '',
        storeName: String(row.storeName || '').trim(),
        storeCounts: new Map(),
        lastAt: '',
        lastKind: row.type === 'purchase' ? 'bought' : 'sold',
        txCount: 0,
        volume: 0,
        customer: row.client || null,
      };
      byCustomer.set(key, entry);
    }

    entry.txCount += 1;
    entry.volume += Math.abs(Number(row.amount) || 0);
    if (row.customerId && !entry.id) entry.id = row.customerId;
    if (row.token) entry.token = row.token;
    if (row.baseUrl) entry.baseUrl = row.baseUrl;
    if (row.systemLabel) entry.systemLabel = row.systemLabel;

    const store = String(row.storeName || '').trim();
    if (store) entry.storeCounts.set(store, (entry.storeCounts.get(store) || 0) + 1);

    const at = row.date || '';
    if (stamp(at) >= stamp(entry.lastAt)) {
      entry.lastAt = at;
      entry.lastKind = row.type === 'purchase' ? 'bought' : 'sold';
    }
  }

  const ranked = Array.from(byCustomer.values()).map((entry) => {
    let topStore = entry.storeName;
    let topCount = 0;
    for (const [name, count] of entry.storeCounts) {
      if (count > topCount) {
        topStore = name;
        topCount = count;
      }
    }
    return {
      id: entry.id,
      label: entry.label,
      systemKey: entry.systemKey,
      systemLabel: entry.systemLabel,
      token: entry.token,
      baseUrl: entry.baseUrl,
      storeName: wanted || topStore,
      lastAt: entry.lastAt,
      lastKind: entry.lastKind,
      txCount: entry.txCount,
      volume: entry.volume,
      activityReady: true,
      client: entry.customer,
    };
  });

  ranked.sort((a, b) => {
    if (sort === 'volume') {
      return b.volume - a.volume || b.txCount - a.txCount || a.label.localeCompare(b.label);
    }
    return b.txCount - a.txCount || b.volume - a.volume || a.label.localeCompare(b.label);
  });

  return ranked.slice(0, limit).map((row, index) => ({ ...row, rank: index + 1 }));
}

export function storeNamesFromRows(rows) {
  const seen = new Set();
  const names = [];
  for (const row of rows || []) {
    const name = String(row?.storeName || '').trim();
    if (!name || name === '—') continue;
    const key = storeKey(name);
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return names.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}
