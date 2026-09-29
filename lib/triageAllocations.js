import { fineMetalFromLine, weightGramsFromLine } from './priceCheck';

export const TRIAGE_DESTINATIONS = [
  { id: 'melt', label: 'Melt' },
  { id: 'rcm', label: 'RCM' },
];

const METAL_SHORT = {
  gold: 'Au',
  silver: 'Ag',
  platinum: 'Pt',
  palladium: 'Pd',
};

const WEIGHT_EPS = 0.001;

function newSplitId() {
  return `split-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function destinationLabel(id) {
  const match = TRIAGE_DESTINATIONS.find((row) => row.id === id);
  return match?.label || String(id || '').trim() || '—';
}

export function roundGrams(value) {
  const n = Math.round((Number(value) || 0) * 1000) / 1000;
  return Object.is(n, -0) ? 0 : n;
}

export function formatGrams(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('en-CA', { maximumFractionDigits: 3 });
}

export function formatObjectWeight(grams) {
  if (!(Number(grams) > 0)) return '';
  return `${formatGrams(grams)} g`;
}

export function formatPureWeight(grams, metal) {
  if (!(Number(grams) > 0)) return '';
  const tag = METAL_SHORT[String(metal || '').toLowerCase()] || '';
  return tag ? `${formatGrams(grams)} g ${tag}` : `${formatGrams(grams)} g pure`;
}

export function lineMetalWeights(line) {
  const fine = fineMetalFromLine(line);
  const objectGrams = fine?.weightGrams ?? weightGramsFromLine(line, { allowQuantity: true });
  return {
    objectGrams: objectGrams > 0 ? objectGrams : 0,
    fineGrams: fine?.fineGrams > 0 ? fine.fineGrams : 0,
    fraction: fine?.fraction > 0 ? fine.fraction : 0,
    metal: fine?.metal || '',
  };
}

export function weightPairLabel(line) {
  const weights = lineMetalWeights(line);
  const object = formatObjectWeight(weights.objectGrams);
  const pure = formatPureWeight(weights.fineGrams, weights.metal);
  if (object && pure) return `${object} · ${pure} pure`;
  if (object) return object;
  if (pure) return `${pure} pure`;
  return '';
}

export function fineForObjectGrams(objectGrams, fraction) {
  const grams = roundGrams(objectGrams);
  const rate = Number(fraction);
  if (!(grams > 0) || !(rate > 0)) return 0;
  return roundGrams(grams * rate);
}

function sanitizeSplit(split, fraction) {
  const destination = TRIAGE_DESTINATIONS.some((row) => row.id === split?.destination)
    ? split.destination
    : 'melt';
  const objectGrams = roundGrams(split?.objectGrams);
  if (!(objectGrams > 0)) return null;
  return {
    id: String(split?.id || newSplitId()),
    destination,
    objectGrams,
    fineGrams: fineForObjectGrams(objectGrams, fraction),
  };
}

export function sanitizeAllocation(allocation) {
  if (!allocation || typeof allocation !== 'object') return null;
  const lines = (Array.isArray(allocation.lines) ? allocation.lines : [])
    .map((line) => {
      const objectGrams = roundGrams(line?.objectGrams);
      const fraction = Number(line?.fraction) > 0 ? Number(line.fraction) : 0;
      const splits = (Array.isArray(line?.splits) ? line.splits : [])
        .map((split) => sanitizeSplit(split, fraction))
        .filter(Boolean);
      return {
        lineIndex: Number(line?.lineIndex) || 0,
        name: String(line?.name || '').trim() || 'Item',
        objectGrams,
        fineGrams: roundGrams(line?.fineGrams) || fineForObjectGrams(objectGrams, fraction),
        fraction,
        metal: String(line?.metal || ''),
        splits,
      };
    })
    .filter((line) => line.objectGrams > 0 || line.splits.length);
  if (!lines.length && !allocation.allocatedAt) return null;
  const allocatedBy =
    allocation.allocatedBy && typeof allocation.allocatedBy === 'object'
      ? {
          id: String(allocation.allocatedBy.id || '').trim(),
          name: String(allocation.allocatedBy.name || '').trim(),
          avatarUrl: String(allocation.allocatedBy.avatarUrl || '').trim(),
        }
      : null;
  return {
    lines,
    totals: destinationTotals({ lines }),
    allocatedAt: String(allocation.allocatedAt || '').trim() || undefined,
    allocatedBy: allocatedBy?.id || allocatedBy?.name ? allocatedBy : undefined,
  };
}

export function allocationDraftFromPo(po, lineTitle) {
  const lines = (Array.isArray(po?.pricedLines) ? po.pricedLines : []).map((line, index) => {
    const weights = lineMetalWeights(line);
    const name =
      (typeof lineTitle === 'function' ? lineTitle(line, index) : '') ||
      String(line?.name || '').trim() ||
      `Item ${index + 1}`;
    const objectGrams = roundGrams(weights.objectGrams);
    return {
      lineIndex: index,
      name,
      objectGrams,
      fineGrams: roundGrams(weights.fineGrams),
      fraction: weights.fraction,
      metal: weights.metal,
      splits:
        objectGrams > 0
          ? [
              {
                id: newSplitId(),
                destination: 'melt',
                objectGrams,
                fineGrams: fineForObjectGrams(objectGrams, weights.fraction),
              },
            ]
          : [],
    };
  });
  return { lines };
}

export function allocationDraftFromSaved(po, saved, lineTitle) {
  const fresh = allocationDraftFromPo(po, lineTitle);
  if (!saved?.lines?.length) return fresh;
  const byIndex = new Map(saved.lines.map((line) => [Number(line.lineIndex), line]));
  return {
    lines: fresh.lines.map((line) => {
      const prev = byIndex.get(line.lineIndex);
      if (!prev) return line;
      const splits = (prev.splits || [])
        .map((split) => sanitizeSplit(split, line.fraction))
        .filter(Boolean);
      return { ...line, splits: splits.length ? splits : line.splits };
    }),
  };
}

export function allocatedObjectGrams(line) {
  return roundGrams((line?.splits || []).reduce((sum, split) => sum + Number(split.objectGrams || 0), 0));
}

export function remainingObjectGrams(line) {
  return roundGrams((line?.objectGrams || 0) - allocatedObjectGrams(line));
}

export function isLineFullyAllocated(line) {
  if (!(Number(line?.objectGrams) > 0)) return true;
  return Math.abs(remainingObjectGrams(line)) <= WEIGHT_EPS;
}

export function isAllocationComplete(draft) {
  const lines = draft?.lines || [];
  if (!lines.some((line) => Number(line.objectGrams) > 0)) return true;
  return lines.every(isLineFullyAllocated);
}

export function destinationTotals(draft) {
  const totals = {};
  for (const dest of TRIAGE_DESTINATIONS) {
    totals[dest.id] = { destination: dest.id, label: dest.label, objectGrams: 0, fineGrams: 0 };
  }
  for (const line of draft?.lines || []) {
    for (const split of line.splits || []) {
      const key = split.destination;
      if (!totals[key]) {
        totals[key] = {
          destination: key,
          label: destinationLabel(key),
          objectGrams: 0,
          fineGrams: 0,
        };
      }
      totals[key].objectGrams = roundGrams(totals[key].objectGrams + Number(split.objectGrams || 0));
      totals[key].fineGrams = roundGrams(
        totals[key].fineGrams + Number(split.fineGrams || fineForObjectGrams(split.objectGrams, line.fraction)),
      );
    }
  }
  return totals;
}

export function setLineSplit(draft, lineIndex, splitId, patch) {
  return {
    ...draft,
    lines: (draft?.lines || []).map((line) => {
      if (line.lineIndex !== lineIndex) return line;
      return {
        ...line,
        splits: (line.splits || []).map((split) => {
          if (split.id !== splitId) return split;
          const next = { ...split, ...patch };
          const objectGrams = roundGrams(next.objectGrams);
          return {
            ...next,
            objectGrams,
            fineGrams: fineForObjectGrams(objectGrams, line.fraction),
          };
        }),
      };
    }),
  };
}

export function addLineSplit(draft, lineIndex, destination = 'melt') {
  return {
    ...draft,
    lines: (draft?.lines || []).map((line) => {
      if (line.lineIndex !== lineIndex) return line;
      const leftover = remainingObjectGrams(line);
      const objectGrams = leftover > WEIGHT_EPS ? leftover : 0;
      return {
        ...line,
        splits: [
          ...(line.splits || []),
          {
            id: newSplitId(),
            destination,
            objectGrams,
            fineGrams: fineForObjectGrams(objectGrams, line.fraction),
          },
        ],
      };
    }),
  };
}

export function removeLineSplit(draft, lineIndex, splitId) {
  return {
    ...draft,
    lines: (draft?.lines || []).map((line) => {
      if (line.lineIndex !== lineIndex) return line;
      const splits = (line.splits || []).filter((split) => split.id !== splitId);
      return { ...line, splits };
    }),
  };
}

export function allocationSummaryLabel(allocation) {
  const totals = destinationTotals(allocation);
  const parts = TRIAGE_DESTINATIONS.map((dest) => {
    const grams = totals[dest.id]?.objectGrams || 0;
    if (!(grams > 0)) return null;
    return `${formatGrams(grams)} g ${dest.label}`;
  }).filter(Boolean);
  return parts.join(' · ') || 'Allocated';
}

export function summarizePoAllocations(pos = []) {
  const rows = (pos || []).map((po) => {
    const allocation = sanitizeAllocation(po?.allocation);
    const complete = Boolean(allocation && isAllocationComplete(allocation));
    return { po, allocation, complete };
  });
  const allocated = rows.filter((row) => row.complete);
  const ready = rows.filter((row) => !row.complete);
  const totals = destinationTotals({
    lines: allocated.flatMap((row) => row.allocation?.lines || []),
  });
  return {
    rows,
    allocated: allocated.length,
    ready: ready.length,
    total: rows.length,
    totals,
  };
}

export function sanitizeAllocationRow(row) {
  const id = String(row?.id || row?.poId || '');
  const allocation = sanitizeAllocation(row?.allocation || row?.payload?.allocation);
  if (!id || !allocation) return null;
  return {
    id,
    allocation,
    updatedAt: String(row.updatedAt || row.updated_at || row.payload?.updatedAt || allocation.allocatedAt || ''),
  };
}
