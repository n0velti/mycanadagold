/**
 * Bullion reconciliation, done in code before the model sees anything.
 *
 * For each unbalanced product the audit gathered a dossier (counts, same-day
 * SO/PO lines, transfers, POS count revisions). This walks the ledger
 * (yesterday's count + bought − sold + transfers in − out, against today's
 * count), lists every concrete mistake that would move the difference by a
 * known quantity, and keeps the ones (alone or in pairs) that add up to the
 * difference. SKU swaps across two products are matched separately.
 *
 * diff = counted − system. A candidate's `qty` is how much of that
 * difference it explains, with the same sign.
 */

const EPS = 0.0005;

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function roundQty(value) {
  return Math.round((Number(value) || 0) * 1000) / 1000;
}

function fmtQty(value) {
  const n = Number(value) || 0;
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}

function signed(value) {
  const n = roundQty(value);
  return `${n > 0 ? '+' : ''}${fmtQty(n)}`;
}

function clip(text, max = 140) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

/** Weight in grams parsed from a product name, for swap matching. */
export function weightGramsOf(name) {
  const text = String(name || '').toLowerCase();
  const kilo = text.match(/(\d+(?:\.\d+)?)\s*(?:kg|kilo)/);
  if (kilo) return Number(kilo[1]) * 1000;
  const oz = text.match(/(\d+(?:\.\d+)?|\d+\/\d+)\s*(?:oz|ounce|troy)/);
  if (oz) {
    const raw = oz[1].includes('/') ? Number(oz[1].split('/')[0]) / Number(oz[1].split('/')[1]) : Number(oz[1]);
    return Math.round(raw * 31.1035 * 100) / 100;
  }
  const grams = text.match(/(\d+(?:\.\d+)?)\s*(?:g|gram|gr)\b/);
  if (grams) return Number(grams[1]);
  return null;
}

function lineGap(line) {
  const quantity = num(line?.quantity);
  const delivered = num(line?.deliveredQuantity);
  if (quantity == null) return 0;
  if (delivered != null) return roundQty(quantity - delivered);
  if (line?.deliveryStatus && !/delivered|complete/i.test(String(line.deliveryStatus))) return roundQty(quantity);
  return 0;
}

function push(list, candidate) {
  const qty = roundQty(candidate.qty);
  if (Math.abs(qty) < EPS) return;
  list.push({ ...candidate, qty, detail: clip(candidate.detail) });
}

function candidatesFor(product) {
  const list = [];
  const { sameDay = {}, transfers = {}, posTrail } = product;

  for (const tx of sameDay.transactions || []) {
    const ref = tx.reference || (tx.type === 'purchase' ? 'PO#' : 'SO#');
    const kind = tx.type === 'purchase' ? 'purchase' : 'sale';
    for (const line of tx.lines || []) {
      const gap = lineGap(line);
      if (gap > EPS) {
        // Sold but not handed over: system dropped it, metal is still here.
        // Bought but not received: system added it, metal is not here.
        push(list, {
          id: `undelivered:${ref}:${line.sku || line.name}`,
          group: `tx:${ref}`,
          score: 90,
          kind: `undelivered-${kind}`,
          ref,
          qty: kind === 'sale' ? gap : -gap,
          detail: `${ref} (${tx.customerName || 'customer'}, ${tx.employeeName || 'staff'}, ${tx.timeLabel || 'today'}) lists ${fmtQty(line.quantity)} × ${line.name || line.sku} but ${line.deliveredQuantity != null ? `${fmtQty(line.deliveredQuantity)} delivered` : `delivery is ${line.deliveryStatus || 'incomplete'}`}. ${kind === 'sale' ? 'The metal may still be in the vault while system already deducted it.' : 'System already added it but the metal may not have come in.'}`,
        });
      }
      const lineQty = num(line.quantity) || 0;
      if (lineQty > EPS) {
        // The whole line entered twice, or on the wrong product.
        push(list, {
          id: `dup:${ref}:${line.sku || line.name}`,
          group: `tx:${ref}`,
          score: 35,
          kind: `${kind}-line-wrong`,
          ref,
          qty: kind === 'sale' ? lineQty : -lineQty,
          detail: `${ref} moved ${fmtQty(lineQty)} × ${line.name || line.sku} out of system${kind === 'sale' ? '' : ' into system'}. If that line is on the wrong product, or was entered twice, system is off by that quantity.`,
        });
      }
    }
    if (tx.paymentStatus && /unpaid|pending|void|cancel/i.test(String(tx.paymentStatus))) {
      const qty = (tx.lines || []).reduce((sum, line) => sum + (num(line.quantity) || 0), 0);
      push(list, {
        id: `unpaid:${ref}`,
        group: `tx:${ref}`,
        score: 60,
        kind: `${kind}-not-paid`,
        ref,
        qty: kind === 'sale' ? qty : -qty,
        detail: `${ref} is ${tx.paymentStatus} but its ${fmtQty(qty)} units already moved in system.`,
      });
    }
  }

  if (transfers.pendingIn > EPS) {
    push(list, {
      id: 'pending-in',
      group: 'transfer-in',
      score: 70,
      kind: 'transfer-arrived-not-received',
      ref: (transfers.list || []).find((tr) => tr.status !== 'received')?.reference || 'TR#',
      qty: transfers.pendingIn,
      detail: `${fmtQty(transfers.pendingIn)} is in transit to this store. If it is already in the vault but not yet received in Aureus, counted is ahead of system by that much.`,
    });
  }
  if (transfers.pendingOut > EPS) {
    push(list, {
      id: 'pending-out',
      group: 'transfer-out',
      score: 70,
      kind: 'transfer-left-still-in-system',
      ref: (transfers.list || []).find((tr) => tr.status !== 'received')?.reference || 'TR#',
      qty: -transfers.pendingOut,
      detail: `${fmtQty(transfers.pendingOut)} was sent out and not yet received at the other store. If system still shows it here, counted is behind system by that much.`,
    });
  }
  if (transfers.receivedShort > EPS) {
    push(list, {
      id: 'received-short',
      group: 'transfer-in',
      score: 80,
      kind: 'transfer-received-short',
      ref: 'TR#',
      qty: -transfers.receivedShort,
      detail: `A received transfer was ${fmtQty(transfers.receivedShort)} short of what was sent.`,
    });
  }
  if (transfers.receivedIn > EPS) {
    push(list, {
      id: 'received-twice',
      group: 'transfer-in',
      score: 30,
      kind: 'transfer-received-wrong-qty',
      ref: 'TR#',
      qty: -transfers.receivedIn,
      detail: `${fmtQty(transfers.receivedIn)} was received in by transfer today. If it was received on the wrong product or twice, system is high by that much.`,
    });
  }

  for (const revision of posTrail?.countRevisions || []) {
    const from = num(revision.vaultFrom);
    const to = num(revision.vaultTo);
    if (from == null || to == null || Math.abs(to - from) < EPS) continue;
    push(list, {
      id: `revision:${revision.id}`,
      group: `revision:${revision.id}`,
      score: 65,
      kind: 'count-edited',
      ref: `inventory log ${revision.id || ''}`.trim(),
      qty: to - from,
      detail: `The vault count was edited from ${fmtQty(from)} to ${fmtQty(to)}${revision.user ? ` by ${revision.user}` : ''}${revision.trailDate ? ` on ${revision.trailDate}` : ''}. If the earlier figure was right, the edit explains ${signed(to - from)}.`,
    });
  }

  for (const event of [...(posTrail?.relatedOrders || []), ...(posTrail?.relatedPurchases || [])]) {
    if (!/delete|void|cancel/i.test(String(event.action || ''))) continue;
    const isOrder = (posTrail?.relatedOrders || []).includes(event);
    const qty = (event.items || [])
      .filter((item) => String(item?.productId) === String(product.productId))
      .reduce((sum, item) => sum + (num(item?.quantity) || 0), 0);
    if (qty < EPS) continue;
    push(list, {
      id: `deleted:${event.id}`,
      group: `deleted:${event.id}`,
      score: 75,
      kind: isOrder ? 'sale-deleted-metal-gone' : 'purchase-deleted-metal-here',
      ref: event.label || (isOrder ? 'SO#' : 'PO#'),
      qty: isOrder ? -qty : qty,
      detail: `${event.label || 'A document'} was ${event.action}${event.user ? ` by ${event.user}` : ''}. ${isOrder ? 'System put the metal back; if it actually left with the customer, counted is low by' : 'System removed the metal; if it is actually in the vault, counted is high by'} ${fmtQty(qty)}.`,
    });
  }

  const storeCount = num(product.storeCount) || 0;
  if (storeCount > EPS) {
    push(list, {
      id: 'in-display',
      group: 'location',
      score: 72,
      kind: 'in-store-display',
      ref: 'store count',
      qty: -storeCount,
      detail: `${fmtQty(storeCount)} is recorded in the store display (storeCount), which is not part of the vault total. If system includes it, the vault is short by that much on paper only.`,
    });
  }
  const otherCount = num(product.otherCount) || 0;
  if (otherCount > EPS) {
    push(list, {
      id: 'in-other',
      group: 'location',
      score: 60,
      kind: 'in-other-location',
      ref: 'other count',
      qty: -otherCount,
      detail: `${fmtQty(otherCount)} is recorded under "other", outside the vault total.`,
    });
  }

  const yesterdayDiff = num(product.yesterdayDiff);
  if (yesterdayDiff != null && Math.abs(yesterdayDiff) > EPS) {
    push(list, {
      id: 'carry',
      group: 'carry',
      score: 85,
      kind: 'predates-today',
      ref: 'yesterday',
      qty: yesterdayDiff,
      detail: `Yesterday's count was already ${signed(yesterdayDiff)} against system. That part did not happen today.`,
    });
  }

  return list;
}

function comboRank(parts) {
  const average = parts.reduce((sum, part) => sum + part.score, 0) / parts.length;
  return average - (parts.length - 1) * 10;
}

function clash(parts) {
  const seen = new Set();
  for (const part of parts) {
    if (seen.has(part.group)) return true;
    seen.add(part.group);
  }
  return false;
}

function findMatches(candidates, target) {
  const exact = [];
  const near = [];
  const consider = (parts) => {
    if (clash(parts)) return;
    const sum = roundQty(parts.reduce((total, part) => total + part.qty, 0));
    const distance = Math.abs(sum - target);
    if (distance < EPS) exact.push(parts);
    else if (distance <= Math.max(1, Math.abs(target) * 0.5)) near.push({ parts, distance });
  };
  for (const part of candidates) consider([part]);
  for (let i = 0; i < candidates.length; i += 1) {
    for (let j = i + 1; j < candidates.length; j += 1) consider([candidates[i], candidates[j]]);
  }
  exact.sort((a, b) => comboRank(b) - comboRank(a) || a.length - b.length);
  near.sort((a, b) => a.distance - b.distance || comboRank(b.parts) - comboRank(a.parts));
  return { exact: exact.slice(0, 4), near: exact.length ? [] : near.slice(0, 3) };
}

function confidenceOf(parts) {
  const rank = comboRank(parts);
  if (parts.length === 1 && rank >= 80) return 'high';
  if (rank >= 60) return 'medium';
  return 'low';
}

function present(parts, { distance } = {}) {
  const sum = roundQty(parts.reduce((total, part) => total + part.qty, 0));
  return {
    size: parts.length,
    explains: sum,
    confidence: confidenceOf(parts),
    kinds: parts.map((part) => part.kind),
    refs: [...new Set(parts.map((part) => part.ref).filter(Boolean))],
    stillOff: distance != null && distance > EPS ? roundQty(distance) : undefined,
    parts: parts.map((part) => ({ kind: part.kind, ref: part.ref, qty: part.qty, detail: part.detail })),
  };
}

/** A and B of the same metal (ideally the same weight) off by equal and opposite amounts. */
export function findSkuSwaps(products) {
  const swaps = [];
  const list = Array.isArray(products) ? products : [];
  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      const a = list[i];
      const b = list[j];
      const da = num(a.diff);
      const db = num(b.diff);
      if (da == null || db == null || Math.abs(da) < EPS || Math.abs(da + db) > EPS) continue;
      if (String(a.metal || '').toLowerCase() !== String(b.metal || '').toLowerCase()) continue;
      const wa = weightGramsOf(a.name);
      const wb = weightGramsOf(b.name);
      const sameWeight = wa != null && wb != null && Math.abs(wa - wb) < 0.05;
      swaps.push({
        over: da > 0 ? { productId: a.productId, name: a.name, sku: a.sku, diff: da } : { productId: b.productId, name: b.name, sku: b.sku, diff: db },
        short: da > 0 ? { productId: b.productId, name: b.name, sku: b.sku, diff: db } : { productId: a.productId, name: a.name, sku: a.sku, diff: da },
        qty: Math.abs(da),
        sameWeight,
        confidence: sameWeight ? 'high' : 'medium',
        detail: `${fmtQty(Math.abs(da))} × ${da > 0 ? a.name : b.name} over and the same amount of ${da > 0 ? b.name : a.name} short, both ${a.metal || 'the same metal'}${sameWeight ? ' and the same weight' : ''}. One was likely counted, sold, or received as the other.`,
      });
    }
  }
  return swaps;
}

function ledgerWalk(product) {
  const yesterdayCounted = num(product.yesterdayCounted);
  const bought = num(product.sameDay?.boughtQty) || 0;
  const sold = num(product.sameDay?.soldQty) || 0;
  const receivedIn = num(product.transfers?.receivedIn) || 0;
  const sentOut = num(product.transfers?.sentOut) || 0;
  const counted = num(product.countedTotal) || 0;
  const system = num(product.systemCount) || 0;
  const walk = {
    yesterdayCounted,
    yesterdaySystem: num(product.yesterdaySystemCount),
    boughtToday: bought,
    soldToday: sold,
    transferredIn: receivedIn,
    transferredOut: sentOut,
    systemToday: system,
    countedToday: counted,
    diff: roundQty(counted - system),
  };
  if (yesterdayCounted != null) {
    walk.expectedFromYesterday = roundQty(yesterdayCounted + bought - sold + receivedIn - sentOut);
    walk.residualVsYesterday = roundQty(counted - walk.expectedFromYesterday);
    walk.formula = 'expectedFromYesterday = yesterdayCounted + boughtToday − soldToday + transferredIn − transferredOut; residualVsYesterday = countedToday − expectedFromYesterday';
  }
  return walk;
}

/**
 * One reconciliation per unbalanced product, plus cross-product swaps.
 * Input: the `investigations` dossiers from gatherBullionAuditContext.
 */
export function explainBullionVariances(investigations) {
  const products = (Array.isArray(investigations) ? investigations : []).map((product) => {
    const diff = roundQty(product.diff);
    const candidates = candidatesFor(product);
    const { exact, near } = findMatches(candidates, diff);
    const walk = ledgerWalk(product);
    const carriedOver = num(product.yesterdayDiff) != null && Math.abs(num(product.yesterdayDiff) - diff) < EPS;
    let verdict = 'unexplained';
    if (carriedOver) verdict = 'predates-today';
    else if (exact.length && confidenceOf(exact[0]) !== 'low') verdict = 'explained';
    else if (exact.length || near.length) verdict = 'possible';
    return {
      productId: product.productId,
      name: product.name,
      sku: product.sku,
      metal: product.metal,
      diff,
      diffLabel: signed(diff),
      verdict,
      ledger: walk,
      checked: {
        sameDayTransactions: (product.sameDay?.transactions || []).length,
        transfers: (product.transfers?.list || []).length,
        countRevisions: (product.posTrail?.countRevisions || []).length,
        documentEdits: (product.posTrail?.relatedOrders || []).length + (product.posTrail?.relatedPurchases || []).length,
        candidates: candidates.length,
      },
      exactMatches: exact.map((parts, index) => ({ rank: index + 1, ...present(parts) })),
      closestMatches: near.map((entry) => present(entry.parts, { distance: entry.distance })),
    };
  });
  const swaps = findSkuSwaps(products);
  for (const swap of swaps) {
    for (const side of [swap.over, swap.short]) {
      const product = products.find((item) => String(item.productId) === String(side.productId));
      if (product && product.verdict !== 'explained') product.verdict = 'swap';
    }
  }
  const summary = {
    products: products.length,
    explained: products.filter((item) => item.verdict === 'explained').length,
    swaps: swaps.length,
    predatesToday: products.filter((item) => item.verdict === 'predates-today').length,
    possible: products.filter((item) => item.verdict === 'possible').length,
    unexplained: products.filter((item) => item.verdict === 'unexplained').length,
  };
  return {
    howToRead:
      'diff = counted − system. Each product has a ledger walk and the mistakes that would explain its diff; exactMatches add up to the diff exactly (rank 1 most likely, confidence high/medium/low), closestMatches are the nearest when nothing adds up. verdict: explained, swap (paired with another product), predates-today (yesterday was already off by the same amount), possible (only a low-confidence or near match), unexplained (nothing in the books adds up; recount).',
    summary,
    swaps,
    products,
  };
}
