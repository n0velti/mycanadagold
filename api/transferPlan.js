import { API_BASE_URL } from './auth';
import {
  bullionPriorityRank,
  fetchBullionProducts,
  fetchProductInventory,
  formatQty,
  resolveBullionPriority,
} from './inventory';
import { fetchPosLocations } from './locations';

/** Territory roles used by Quebec / Workshop transfer splits. */
export const TERRITORY_KEYS = ['montreal', 'laval', 'quebec_city', 'workshop'];

export const TERRITORY_LABELS = {
  montreal: 'Montreal',
  laval: 'Laval',
  quebec_city: 'Quebec City',
  workshop: 'Workshop',
};

/**
 * Quebec-only balance (no Workshop on the route).
 * Red inventory is skipped ("doesn't matter").
 */
export const QUEBEC_SPLITS = {
  green: { montreal: 50, laval: 25, quebec_city: 25 },
  yellow: { montreal: 50, laval: 25, quebec_city: 25 },
  red: null,
};

/**
 * When Workshop is on the route (bullion pulled toward Workshop).
 */
export const WORKSHOP_SPLITS = {
  green: { montreal: 50, laval: 25, quebec_city: 25, workshop: 0 },
  yellow: { montreal: 25, laval: 12.5, quebec_city: 12.5, workshop: 50 },
  red: { montreal: 0, laval: 0, quebec_city: 0, workshop: 100 },
};

export function isWorkshopStore(store) {
  if (store?.isWorkshop) return true;
  return String(store?.name || '')
    .trim()
    .toLowerCase() === 'workshop';
}

export function resolveTerritoryKey(store) {
  const name = String(store?.name || '')
    .trim()
    .toLowerCase();
  if (!name) return null;
  if (name === 'workshop' || name.includes('workshop')) return 'workshop';
  if (name.includes('montreal')) return 'montreal';
  if (name.includes('laval')) return 'laval';
  if (name === 'quebec' || name.includes('quebec')) return 'quebec_city';
  return null;
}

export function cloneSplits(splits) {
  const next = {};
  for (const tier of ['green', 'yellow', 'red']) {
    const row = splits?.[tier];
    next[tier] = row ? { ...row } : null;
  }
  return next;
}

export function defaultSplitsForMode(mode) {
  return cloneSplits(mode === 'workshop' ? WORKSHOP_SPLITS : QUEBEC_SPLITS);
}

export function detectTransferMode(stores) {
  return stores.some(isWorkshopStore) ? 'workshop' : 'quebec';
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Largest-remainder allocation so integer targets sum to `total`.
 */
export function allocateByPercent(total, percentByKey) {
  const entries = Object.entries(percentByKey || {}).filter(([, pct]) => toNumber(pct) > 0);
  const weightSum = entries.reduce((sum, [, pct]) => sum + toNumber(pct), 0);
  if (total <= 0 || weightSum <= 0 || entries.length === 0) {
    const zeros = {};
    for (const key of Object.keys(percentByKey || {})) zeros[key] = 0;
    return zeros;
  }

  const raw = entries.map(([key, pct]) => {
    const exact = (total * toNumber(pct)) / weightSum;
    const floor = Math.floor(exact);
    return { key, floor, frac: exact - floor };
  });

  let assigned = raw.reduce((sum, row) => sum + row.floor, 0);
  let remaining = Math.round(total) - assigned;
  raw.sort((a, b) => b.frac - a.frac || a.key.localeCompare(b.key));
  for (let i = 0; i < raw.length && remaining > 0; i += 1) {
    raw[i].floor += 1;
    remaining -= 1;
  }

  const result = {};
  for (const key of Object.keys(percentByKey || {})) result[key] = 0;
  for (const row of raw) result[row.key] = row.floor;
  return result;
}

/**
 * One-way surplus→deficit moves along the route order only.
 * Earlier stops may ship to later stops; never backward.
 */
export function buildForwardMoves(orderedStoreIds, currentById, targetById, storeById) {
  const nodes = orderedStoreIds.map((id) => ({
    id,
    avail: Math.max(0, toNumber(currentById[id]) - toNumber(targetById[id])),
    need: Math.max(0, toNumber(targetById[id]) - toNumber(currentById[id])),
  }));

  const moves = [];

  for (let i = 0; i < nodes.length; i += 1) {
    if (nodes[i].avail <= 0) continue;
    // Fill nearer downstream stops first, then further ones.
    for (let j = i + 1; j < nodes.length && nodes[i].avail > 0; j += 1) {
      if (nodes[j].need <= 0) continue;
      const qty = Math.min(nodes[i].avail, nodes[j].need);
      if (qty <= 0) continue;
      moves.push({
        fromId: nodes[i].id,
        toId: nodes[j].id,
        fromName: storeById.get(nodes[i].id)?.name || nodes[i].id,
        toName: storeById.get(nodes[j].id)?.name || nodes[j].id,
        qty,
      });
      nodes[i].avail -= qty;
      nodes[j].need -= qty;
    }
  }

  const unmetNeed = nodes.reduce((sum, node) => sum + node.need, 0);
  const stranded = nodes.reduce((sum, node) => sum + node.avail, 0);

  return { moves, unmetNeed, stranded };
}

/** @deprecated use buildForwardMoves — kept for callers expecting old name */
export function buildMoves(currentById, targetById, storeById, orderedStoreIds) {
  const order =
    Array.isArray(orderedStoreIds) && orderedStoreIds.length
      ? orderedStoreIds
      : Object.keys(targetById);
  return buildForwardMoves(order, currentById, targetById, storeById).moves;
}

function buildStopSheets(orderedStores, movingProducts, catalogProducts) {
  return orderedStores.map((store, index) => {
    const outs = [];
    const ins = [];
    const outByProduct = new Map();

    for (const product of movingProducts) {
      for (const move of product.moves) {
        if (move.fromId === store.id) {
          outs.push({
            productId: product.id,
            productName: product.name,
            sku: product.sku,
            priority: product.priority,
            qty: move.qty,
            currentQty: Math.max(0, toNumber(product.currentById?.[store.id])),
            partnerId: move.toId,
            partnerName: move.toName,
          });
          outByProduct.set(
            product.id,
            (outByProduct.get(product.id) || 0) + move.qty,
          );
        }
        if (move.toId === store.id) {
          ins.push({
            productId: product.id,
            productName: product.name,
            sku: product.sku,
            priority: product.priority,
            qty: move.qty,
            partnerId: move.fromId,
            partnerName: move.fromName,
          });
        }
      }
    }

    const staying = [];
    for (const product of catalogProducts) {
      const current = Math.max(0, toNumber(product.currentById?.[store.id]));
      if (current <= 0) continue;
      const shipped = outByProduct.get(product.id) || 0;
      const stayQty = current - shipped;
      if (stayQty <= 0) continue;
      staying.push({
        productId: product.id,
        productName: product.name,
        sku: product.sku,
        priority: product.priority,
        currentQty: current,
        stayQty,
        shippedQty: shipped,
      });
    }

    outs.sort((a, b) =>
      bullionPriorityRank(a.priority) - bullionPriorityRank(b.priority) ||
      a.productName.localeCompare(b.productName, undefined, { sensitivity: 'base' }),
    );
    ins.sort((a, b) =>
      bullionPriorityRank(a.priority) - bullionPriorityRank(b.priority) ||
      a.productName.localeCompare(b.productName, undefined, { sensitivity: 'base' }),
    );
    staying.sort((a, b) =>
      bullionPriorityRank(a.priority) - bullionPriorityRank(b.priority) ||
      a.productName.localeCompare(b.productName, undefined, { sensitivity: 'base' }),
    );

    return {
      storeId: store.id,
      storeName: store.name,
      isWorkshop: isWorkshopStore(store),
      index,
      outs,
      ins,
      staying,
      outUnits: outs.reduce((sum, row) => sum + row.qty, 0),
      inUnits: ins.reduce((sum, row) => sum + row.qty, 0),
      stayingUnits: staying.reduce((sum, row) => sum + row.stayQty, 0),
      stayingCount: staying.length,
    };
  });
}

export function moveQtyKey(productId, fromId, toId) {
  return `${productId}|${fromId}|${toId}`;
}

export function parseMoveQtyKey(key) {
  const [productId, fromId, toId] = String(key).split('|');
  return { productId, fromId, toId };
}

/** Default one-way destination: final stop after the current store. */
export function defaultForwardStop(routeStores, fromId) {
  const idx = (routeStores || []).findIndex((store) => store.id === fromId);
  if (idx < 0 || idx >= routeStores.length - 1) return null;
  return routeStores[routeStores.length - 1];
}

/**
 * Apply manual send-qty edits on top of a computed plan.
 * overrides: { [moveQtyKey]: number }
 */
export function applyMoveQtyOverrides(plan, overrides = {}) {
  if (!plan) return null;

  const routeStores = plan.stores || [];
  const storeById = new Map(routeStores.map((store) => [store.id, store]));
  const catalog = plan.catalog || [];
  const catalogById = new Map(catalog.map((product) => [product.id, product]));

  const legs = new Map();

  for (const product of plan.products || []) {
    for (const move of product.moves || []) {
      const key = moveQtyKey(product.id, move.fromId, move.toId);
      legs.set(key, {
        productId: product.id,
        fromId: move.fromId,
        toId: move.toId,
        baseQty: toNumber(move.qty),
      });
    }
  }

  for (const key of Object.keys(overrides || {})) {
    if (legs.has(key)) continue;
    const { productId, fromId, toId } = parseMoveQtyKey(key);
    if (!catalogById.has(productId) || !storeById.has(fromId) || !storeById.has(toId)) {
      continue;
    }
    const fromIndex = routeStores.findIndex((store) => store.id === fromId);
    const toIndex = routeStores.findIndex((store) => store.id === toId);
    if (fromIndex < 0 || toIndex <= fromIndex) continue;
    legs.set(key, { productId, fromId, toId, baseQty: 0 });
  }

  const resolved = [];
  for (const [key, leg] of legs.entries()) {
    const hasOverride = Object.prototype.hasOwnProperty.call(overrides || {}, key);
    let qty = hasOverride ? toNumber(overrides[key]) : leg.baseQty;
    if (!Number.isFinite(qty) || qty < 0) qty = 0;
    qty = Math.round(qty);
    resolved.push({ key, ...leg, qty });
  }

  // Cap total outbound per product/store to on-hand qty.
  const groups = new Map();
  for (const leg of resolved) {
    const groupKey = `${leg.productId}|${leg.fromId}`;
    if (!groups.has(groupKey)) groups.set(groupKey, []);
    groups.get(groupKey).push(leg);
  }
  for (const [, group] of groups.entries()) {
    const product = catalogById.get(group[0].productId);
    const onHand = Math.max(0, Math.round(toNumber(product?.currentById?.[group[0].fromId])));
    let used = 0;
    for (const leg of group) {
      const next = Math.min(leg.qty, Math.max(0, onHand - used));
      leg.qty = next;
      used += next;
    }
  }

  const byProduct = new Map();
  for (const leg of resolved) {
    if (leg.qty <= 0) continue;
    const product = catalogById.get(leg.productId);
    if (!product) continue;
    if (!byProduct.has(leg.productId)) {
      byProduct.set(leg.productId, {
        ...product,
        moves: [],
        custom: product.custom,
      });
    }
    byProduct.get(leg.productId).moves.push({
      fromId: leg.fromId,
      toId: leg.toId,
      fromName: storeById.get(leg.fromId)?.name || leg.fromId,
      toName: storeById.get(leg.toId)?.name || leg.toId,
      qty: leg.qty,
    });
  }

  const products = Array.from(byProduct.values()).sort((a, b) => {
    const rankDiff = bullionPriorityRank(a.priority) - bullionPriorityRank(b.priority);
    if (rankDiff !== 0) return rankDiff;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });

  const stopSheets = buildStopSheets(routeStores, products, catalog);
  const totalMoves = products.reduce((sum, product) => sum + product.moves.length, 0);
  const totalUnits = products.reduce(
    (sum, product) => sum + product.moves.reduce((inner, move) => inner + move.qty, 0),
    0,
  );

  return {
    ...plan,
    products,
    stopSheets,
    totalMoves,
    totalUnits,
    hasManualEdits: Object.keys(overrides || {}).length > 0,
  };
}

function percentsForSelectedStores(tierPercents, territoryByStoreId) {
  if (!tierPercents) return null;
  const result = {};
  let any = false;
  for (const [storeId, territory] of territoryByStoreId.entries()) {
    if (Object.prototype.hasOwnProperty.call(tierPercents, territory)) {
      const raw = tierPercents[territory];
      result[storeId] = raw === '' || raw === '.' ? 0 : toNumber(raw);
      any = true;
    }
  }
  return any ? result : null;
}

/**
 * Compute one-way transfer recommendations along the route order.
 * Route arrows are forward-only (e.g. Montreal → Laval → Workshop).
 */
export function computeTransferPlan({
  stores,
  rows,
  splits,
  itemOverrides = {},
}) {
  const mode = detectTransferMode(stores);
  const storeById = new Map(stores.map((store) => [store.id, store]));
  const territoryByStoreId = new Map();
  const unknown = [];

  // Preserve route order; only Quebec/Workshop stops enter the balance pool.
  const routeStores = [];
  for (const store of stores) {
    const territory = resolveTerritoryKey(store);
    if (territory) {
      territoryByStoreId.set(store.id, territory);
      routeStores.push(store);
    } else {
      unknown.push(store.name);
    }
  }

  const orderedStoreIds = routeStores.map((store) => store.id);
  const products = [];
  const catalog = [];
  let unmetUnits = 0;
  let strandedUnits = 0;

  for (const row of rows) {
    const priority = row.priority;
    if (!priority) continue;

    const override = itemOverrides[row.id];
    const tierPercents = override || splits?.[priority];
    if (!tierPercents) continue;

    const percentByStoreId = percentsForSelectedStores(tierPercents, territoryByStoreId);
    if (!percentByStoreId) continue;

    const currentById = {};
    let total = 0;
    for (const store of routeStores) {
      const qty = Math.max(0, Math.round(toNumber(row.quantities?.[store.id])));
      currentById[store.id] = qty;
      total += qty;
    }

    if (total <= 0) continue;

    const targetById = allocateByPercent(total, percentByStoreId);
    for (const store of routeStores) {
      if (targetById[store.id] == null) targetById[store.id] = 0;
    }

    const { moves, unmetNeed, stranded } = buildForwardMoves(
      orderedStoreIds,
      currentById,
      targetById,
      storeById,
    );
    unmetUnits += unmetNeed;
    strandedUnits += stranded;

    const entry = {
      id: row.id,
      name: row.name,
      sku: row.sku,
      priority,
      total,
      currentById,
      targetById,
      percentByStoreId,
      moves,
      unmetNeed,
      stranded,
      custom: Boolean(override),
    };
    catalog.push(entry);
    if (moves.length > 0) products.push(entry);
  }

  products.sort((a, b) => {
    const rankDiff = bullionPriorityRank(a.priority) - bullionPriorityRank(b.priority);
    if (rankDiff !== 0) return rankDiff;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });

  catalog.sort((a, b) => {
    const rankDiff = bullionPriorityRank(a.priority) - bullionPriorityRank(b.priority);
    if (rankDiff !== 0) return rankDiff;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });

  const stopSheets = buildStopSheets(routeStores, products, catalog);

  return {
    mode,
    stores: routeStores,
    territoryByStoreId: Object.fromEntries(territoryByStoreId),
    unknownStores: unknown,
    products,
    catalog,
    stopSheets,
    totalMoves: products.reduce((sum, product) => sum + product.moves.length, 0),
    totalUnits: products.reduce(
      (sum, product) => sum + product.moves.reduce((inner, move) => inner + move.qty, 0),
      0,
    ),
    unmetUnits,
    strandedUnits,
    routeBlocked: unmetUnits > 0 || strandedUnits > 0,
  };
}

/**
 * Inventory for transfer planning (East POS only), including Workshop.
 * Quantities are keyed by transfer store ids (`east-${sourceId}`).
 */
export async function fetchTransferInventory(session, transferStores) {
  const token = session?.token;
  const baseUrl = session?.baseUrl || API_BASE_URL;
  if (!token) throw new Error('Not signed in.');

  const eastStores = (transferStores || []).filter((store) => store.systemKey === 'east');
  if (eastStores.length === 0) {
    return { rows: [], warning: 'Select Canada Gold East stores to plan a transfer.' };
  }

  const [locations, products] = await Promise.all([
    fetchPosLocations(baseUrl, token),
    fetchBullionProducts(token, baseUrl),
  ]);

  const locationById = new Map(
    locations.map((location) => [String(location.id), location]),
  );

  const productIds = products.map((product) => String(product.id));
  const { stocks } = await fetchProductInventory(token, productIds, baseUrl);

  const rows = products
    .map((product) => {
      const id = String(product.id);
      const quantities = {};
      let total = 0;

      for (const store of eastStores) {
        const sourceId = String(store.sourceId);
        const qty = (() => {
          const entries = stocks[id];
          if (!Array.isArray(entries)) return 0;
          let sum = 0;
          for (const entry of entries) {
            if (String(entry?.location_id) === sourceId) {
              sum += toNumber(entry?.quantity);
            }
          }
          return sum;
        })();
        quantities[store.id] = qty;
        total += qty;
      }

      return {
        id,
        name: product.name || product.sku || `Product ${id}`,
        sku: product.sku || '',
        metal: product.metal || '',
        priority: resolveBullionPriority(product),
        quantities,
        total,
        locationNames: eastStores.map((store) => {
          const loc = locationById.get(String(store.sourceId));
          return loc?.name || store.name;
        }),
      };
    })
    .filter((row) => row.priority && row.total > 0)
    .sort((a, b) => {
      const rankDiff = bullionPriorityRank(a.priority) - bullionPriorityRank(b.priority);
      if (rankDiff !== 0) return rankDiff;
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });

  return { rows, warning: '' };
}

export function formatPercent(value) {
  const n = toNumber(value);
  if (Number.isInteger(n)) return String(n);
  return String(Math.round(n * 10) / 10);
}

export { formatQty };

/**
 * Build printable HTML for the transfer plan PDF / print dialog.
 * Simple per-stop OUT / IN tables along the one-way route.
 */
export function buildTransferPlanHtml(plan, { pathLabels = [], splits, generatedAt = new Date() } = {}) {
  const when = generatedAt.toLocaleString();
  const path = pathLabels.length ? pathLabels.join(' → ') : '—';
  const modeLabel =
    plan.mode === 'workshop' ? 'Workshop route' : 'Quebec balance route';

  const pctNote = ['green', 'yellow', 'red']
    .map((tier) => {
      const row = splits?.[tier];
      if (!row) return `${tier}: n/a`;
      const parts = (plan.stores || []).map((store) => {
        const territory = plan.territoryByStoreId?.[store.id];
        const pct = territory != null ? row[territory] : null;
        return `${store.name} ${pct == null ? '—' : `${formatPercent(pct)}%`}`;
      });
      return `${tier}: ${parts.join(', ')}`;
    })
    .join(' · ');

  const stopBlocks = (plan.stopSheets || [])
    .filter((sheet) => sheet.outs.length > 0 || sheet.ins.length > 0)
    .map((sheet) => {
      const outRows = sheet.outs
        .map(
          (row) => `
        <tr>
          <td><span class="dot ${priorityClass(row.priority)}"></span>${escapeHtml(row.productName)}</td>
          <td class="num">${formatQty(row.currentQty ?? 0)}</td>
          <td class="num">${formatQty(row.qty)}</td>
          <td>→ ${escapeHtml(row.partnerName)}</td>
        </tr>`,
        )
        .join('');
      const inRows = sheet.ins
        .map(
          (row) => `
        <tr>
          <td><span class="dot ${priorityClass(row.priority)}"></span>${escapeHtml(row.productName)}</td>
          <td class="num">${formatQty(row.qty)}</td>
          <td>← ${escapeHtml(row.partnerName)}</td>
        </tr>`,
        )
        .join('');

      return `
      <section class="stop">
        <h2>${escapeHtml(sheet.storeName)}${sheet.isWorkshop ? ' ★' : ''}</h2>
        ${
          sheet.outs.length
            ? `<h3>Transfer OUT (${formatQty(sheet.outUnits)})</h3>
               <table>
                 <thead><tr><th>Product</th><th>On hand</th><th>Send</th><th>To</th></tr></thead>
                 <tbody>${outRows}</tbody>
               </table>`
            : '<p class="empty">No outbound</p>'
        }
        ${
          sheet.ins.length
            ? `<h3>Transfer IN (${formatQty(sheet.inUnits)})</h3>
               <table>
                 <thead><tr><th>Product</th><th>Qty</th><th>From</th></tr></thead>
                 <tbody>${inRows}</tbody>
               </table>`
            : '<p class="empty">No inbound</p>'
        }
      </section>`;
    })
    .join('');

  const blockedNote = plan.routeBlocked
    ? `<p class="warn">Note: some target % could not be fully met without sending inventory backward on this route.</p>`
    : '';

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Transfer plan</title>
  <style>
    body { font-family: Sohne, sans-serif; color: #1a1a1a; margin: 28px; font-size: 13px; }
    h1 { font-size: 20px; margin: 0 0 4px; }
    h2 { font-size: 16px; margin: 0 0 8px; border-bottom: 2px solid #1a1a1a; padding-bottom: 4px; }
    h3 { font-size: 12px; margin: 12px 0 6px; text-transform: uppercase; letter-spacing: 0.04em; color: #555; }
    .sub { color: #666; margin: 0 0 6px; }
    .pct { color: #777; font-size: 11px; margin: 0 0 18px; }
    .warn { color: #9A6B00; background: #FFF8E8; padding: 8px 10px; border-radius: 6px; }
    .stop { break-inside: avoid; margin: 0 0 22px; }
    table { border-collapse: collapse; width: 100%; margin: 0 0 8px; }
    th, td { border: 1px solid #ddd; padding: 7px 8px; text-align: left; vertical-align: middle; }
    th { background: #f4f4f4; font-size: 11px; text-transform: uppercase; letter-spacing: 0.03em; }
    .num { text-align: right; font-variant-numeric: tabular-nums; font-weight: 600; width: 64px; }
    .dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; margin-right: 6px; }
    .dot.green { background: #2F8A4E; }
    .dot.yellow { background: #C9A227; }
    .dot.red { background: #C43C3C; }
    .empty { color: #999; margin: 4px 0 10px; font-size: 12px; }
  </style>
</head>
<body>
  <h1>Transfer plan</h1>
  <p class="sub">${escapeHtml(modeLabel)} · ${escapeHtml(when)}</p>
  <p class="sub"><strong>Route (one-way):</strong> ${escapeHtml(path)}</p>
  <p class="pct">${escapeHtml(pctNote)}</p>
  ${blockedNote}
  ${stopBlocks || '<p>Nothing to transfer — inventory already matches the targets for this route.</p>'}
</body>
</html>`;
}

function priorityClass(priority) {
  return /^(green|yellow|red)$/.test(String(priority || '')) ? priority : '';
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
