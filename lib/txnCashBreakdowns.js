import { useCallback, useEffect, useMemo, useState } from 'react';
import { getSupabase } from './supabase';
import {
  CASH_DENOMS,
  USD_DENOMS,
  addPieceMaps,
  denomsForCurrency,
  emptyDenomCounts,
  parseCount,
} from './cashDenoms';
import {
  formatDateParam,
  isCashTransaction,
  parseDateParam,
  txnCashAmount,
  txnCashCurrency,
} from './transactions';

function asString(value) {
  if (value == null) return '';
  return String(value).trim();
}

function storeKey(storeName) {
  return asString(storeName).toLowerCase();
}

function toNumber(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function isMissingRelation(error) {
  const code = String(error?.code || '');
  const message = String(error?.message || '');
  if (code === '42P01' || code === 'PGRST205') return true;
  return /schema cache/i.test(message) && /transaction_cash_breakdowns/i.test(message);
}

function isPermissionError(error) {
  const code = String(error?.code || '');
  const message = String(error?.message || '');
  return code === '42501' || code === 'PGRST301' || /permission denied|row-level security/i.test(message);
}

function describeError(error, action = 'load') {
  if (!error) return `Could not ${action} cash breakdown.`;
  if (isMissingRelation(error)) {
    return 'Run the transaction cash-breakdown SQL in Supabase, including the schema reload line, then refresh.';
  }
  if (error.code === 'NO_SESSION') return error.message;
  if (isPermissionError(error)) {
    return action === 'save'
      ? 'No permission to save cash breakdowns. Sign out and sign in again, then retry.'
      : 'No permission to load cash breakdowns. Sign out and sign in again, then retry.';
  }
  return error.message || `Could not ${action} cash breakdown.`;
}

async function requireClient() {
  const supabase = getSupabase();
  const { data } = await supabase.auth.getSession();
  if (!data?.session?.user?.id) {
    const error = new Error('Sign out and sign in again so cash breakdowns can load.');
    error.code = 'NO_SESSION';
    throw error;
  }
  return supabase;
}

function normalizeCounts(source, denoms) {
  const next = emptyDenomCounts(denoms);
  const raw = source && typeof source === 'object' ? source : {};
  for (const denom of denoms) {
    const value = raw[denom.key];
    next[denom.key] = value == null || value === '' ? '' : String(value);
  }
  return next;
}

function compactCounts(counts, denoms) {
  const next = {};
  for (const denom of denoms) {
    const value = String(counts?.[denom.key] || '').trim();
    if (value) next[denom.key] = value;
  }
  return next;
}

export function countsHaveValues(counts) {
  return Object.values(counts || {}).some((value) => String(value || '').trim());
}

export function sidePieces(counts, denoms) {
  const next = {};
  for (const denom of denoms) {
    next[denom.key] = parseCount(counts?.[denom.key]) || 0;
  }
  return next;
}

export function netFromSides(received, given, denoms) {
  let total = 0;
  for (const denom of denoms) {
    const inN = parseCount(received?.[denom.key]) || 0;
    const outN = parseCount(given?.[denom.key]) || 0;
    total += (inN - outN) * denom.face;
  }
  return Math.round(total * 100) / 100;
}

function keyFromPayableReference(reference, systemKey) {
  const match = String(reference || '').match(/\b(SO|PO)#\s*(\d+)/i);
  if (!match) return '';
  const prefix = match[1].toUpperCase() === 'PO' ? 'po' : 'so';
  const base = `${prefix}-${match[2]}`;
  const system = String(systemKey || 'east');
  return system === 'east' ? base : `${system}-${base}`;
}

export function cashBreakdownKey(row) {
  if (!row) return '';
  if (row.kind === 'cash_transaction') return asString(row.id);
  if (row.type === 'order' || row.type === 'purchase') return asString(row.id);
  return keyFromPayableReference(row.reference, row.systemKey) || asString(row.id);
}

function txnTypeForRow(row, key) {
  if (row?.kind === 'cash_transaction') return 'cash_transaction';
  if (row?.type === 'purchase' || row?.type === 'order') return row.type;
  const parsed = String(key || '').match(/(?:^|-)(so|po)-(\d+)$/i);
  if (parsed) return parsed[1].toLowerCase() === 'po' ? 'purchase' : 'order';
  return 'payment';
}

function sourceIdForRow(row, key) {
  const parsed = String(key || '').match(/(?:^|-)(?:so|po)-(\d+)$/i);
  if (parsed && (row?.type === 'In' || row?.type === 'Out') && row?.kind !== 'cash_transaction') {
    return parsed[1];
  }
  return row?.sourceId != null ? String(row.sourceId) : parsed?.[1] || null;
}

export function emptyBreakdownSheet(currency = 'CAD') {
  const denoms = denomsForCurrency(currency);
  return {
    transactionId: '',
    received: emptyDenomCounts(denoms),
    given: emptyDenomCounts(denoms),
    currency: String(currency || 'CAD').toUpperCase() === 'USD' ? 'USD' : 'CAD',
    cashAmount: null,
    netAmount: null,
    hasCount: false,
  };
}

function mapRow(row) {
  const currency = String(row?.currency || 'CAD').toUpperCase() === 'USD' ? 'USD' : 'CAD';
  const denoms = currency === 'USD' ? USD_DENOMS : CASH_DENOMS;
  const received = normalizeCounts(row?.received, denoms);
  const given = normalizeCounts(row?.given, denoms);
  return {
    transactionId: row?.transaction_id || '',
    sourceId: row?.source_id || null,
    txnType: row?.txn_type || '',
    systemKey: row?.system_key || '',
    storeKey: row?.store_key || '',
    storeName: row?.store_name || '',
    date: row?.txn_date || null,
    currency,
    received,
    given,
    cashAmount: toNumber(row?.cash_amount),
    netAmount: toNumber(row?.net_amount),
    updatedAt: row?.updated_at || null,
    hasCount: countsHaveValues(received) || countsHaveValues(given),
  };
}

async function chunkedIn(supabase, column, ids, select) {
  const unique = Array.from(new Set((ids || []).map((id) => asString(id)).filter(Boolean)));
  if (!unique.length) return [];
  const chunks = [];
  for (let i = 0; i < unique.length; i += 80) chunks.push(unique.slice(i, i + 80));
  const pages = await Promise.all(
    chunks.map(async (chunk) => {
      const { data, error } = await supabase
        .from('transaction_cash_breakdowns')
        .select(select)
        .in(column, chunk);
      if (error) throw error;
      return data || [];
    }),
  );
  return pages.flat();
}

export async function loadTxnCashBreakdowns(ids) {
  const keys = (ids || []).map((id) => asString(id)).filter(Boolean);
  if (!keys.length) return {};
  try {
    const supabase = await requireClient();
    const data = await chunkedIn(
      supabase,
      'transaction_id',
      keys,
      'transaction_id, source_id, txn_type, system_key, store_key, store_name, txn_date, currency, received, given, cash_amount, net_amount, updated_at',
    );
    const next = {};
    for (const row of data) {
      const sheet = mapRow(row);
      if (sheet.transactionId) next[sheet.transactionId] = sheet;
    }
    return next;
  } catch (error) {
    if (isMissingRelation(error)) return {};
    throw new Error(describeError(error, 'load'));
  }
}

export async function loadStoreDayTxnCashBreakdowns(storeName, date) {
  const key = storeKey(storeName);
  const day = formatDateParam(parseDateParam(date || new Date()));
  if (!key) return [];
  try {
    const supabase = await requireClient();
    const { data, error } = await supabase
      .from('transaction_cash_breakdowns')
      .select(
        'transaction_id, source_id, txn_type, system_key, store_key, store_name, txn_date, currency, received, given, cash_amount, net_amount, updated_at',
      )
      .eq('store_key', key)
      .eq('txn_date', day);
    if (error) throw error;
    return (data || []).map(mapRow).filter((row) => row.hasCount);
  } catch (error) {
    if (isMissingRelation(error)) return [];
    throw new Error(describeError(error, 'load'));
  }
}

export function sumBreakdownPieces(rows, currency) {
  const code = String(currency || 'CAD').toUpperCase() === 'USD' ? 'USD' : 'CAD';
  const denoms = denomsForCurrency(code);
  let received = emptyDenomCounts(denoms);
  let given = emptyDenomCounts(denoms);
  received = sidePieces(received, denoms);
  given = sidePieces(given, denoms);
  let count = 0;
  for (const row of rows || []) {
    if (row.currency !== code || !row.hasCount) continue;
    received = addPieceMaps(received, sidePieces(row.received, denoms));
    given = addPieceMaps(given, sidePieces(row.given, denoms));
    count += 1;
  }
  return {
    currency: code,
    count,
    received,
    given,
    net: addPieceMaps(received, given, -1),
  };
}

export async function saveTxnCashBreakdown(row, sheet, userId) {
  const key = cashBreakdownKey(row);
  if (!key) throw new Error('Missing transaction.');
  const name = asString(row?.storeName);
  const keyStore = storeKey(name);
  if (!keyStore) throw new Error('Choose a store.');

  const currency =
    String(sheet?.currency || txnCashCurrency(row) || 'CAD').toUpperCase() === 'USD' ? 'USD' : 'CAD';
  const denoms = denomsForCurrency(currency);
  const received = normalizeCounts(sheet?.received, denoms);
  const given = normalizeCounts(sheet?.given, denoms);
  const hasCount = countsHaveValues(received) || countsHaveValues(given);
  const supabase = await requireClient();

  if (!hasCount) {
    const { error } = await supabase
      .from('transaction_cash_breakdowns')
      .delete()
      .eq('transaction_id', key);
    if (error) throw new Error(describeError(error, 'save'));
    return { ...emptyBreakdownSheet(currency), transactionId: key, hasCount: false };
  }

  const { data: authData } = await supabase.auth.getSession();
  const actorId = authData?.session?.user?.id || userId || null;
  const netAmount = netFromSides(received, given, denoms);
  const payload = {
    transaction_id: key,
    source_id: sourceIdForRow(row, key),
    txn_type: txnTypeForRow(row, key),
    system_key: row?.systemKey || 'east',
    store_key: keyStore,
    store_name: name,
    txn_date: formatDateParam(parseDateParam(row?.date || row?.dateLabel || new Date())),
    currency,
    received: compactCounts(received, denoms),
    given: compactCounts(given, denoms),
    cash_amount: toNumber(sheet?.cashAmount ?? txnCashAmount(row)),
    net_amount: netAmount,
    updated_at: new Date().toISOString(),
    updated_by: actorId,
  };

  const { error } = await supabase
    .from('transaction_cash_breakdowns')
    .upsert(payload, { onConflict: 'transaction_id' });
  if (error) throw new Error(describeError(error, 'save'));

  return {
    ...emptyBreakdownSheet(currency),
    ...payload,
    transactionId: key,
    received,
    given,
    cashAmount: payload.cash_amount,
    netAmount,
    hasCount: true,
  };
}

export function subscribeStoreTxnCashBreakdowns(storeName, onChange) {
  const key = storeKey(storeName);
  if (!key || typeof onChange !== 'function') return () => {};

  const supabase = getSupabase();
  const channel = supabase
    .channel(`txn-cash-${key}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'transaction_cash_breakdowns',
        filter: `store_key=eq.${key}`,
      },
      () => {
        onChange();
      },
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

export function useTxnCashBreakdowns(rows) {
  const cashRows = useMemo(
    () => (rows || []).filter((row) => isCashTransaction(row) && cashBreakdownKey(row)),
    [rows],
  );
  const idKey = useMemo(
    () =>
      cashRows
        .map((row) => cashBreakdownKey(row))
        .filter(Boolean)
        .sort()
        .join(','),
    [cashRows],
  );
  const [byId, setById] = useState({});
  const [editorRow, setEditorRow] = useState(null);
  const storeKeys = useMemo(() => {
    const keys = new Set();
    for (const row of cashRows) {
      const key = storeKey(row?.storeName);
      if (key) keys.add(key);
    }
    return Array.from(keys).sort();
  }, [cashRows]);
  const storeKeysKey = storeKeys.join(',');

  useEffect(() => {
    if (!idKey) {
      setById({});
      return undefined;
    }
    let cancelled = false;
    const reload = () => {
      loadTxnCashBreakdowns(idKey.split(','))
        .then((next) => {
          if (!cancelled) setById(next);
        })
        .catch(() => {
          if (!cancelled) setById({});
        });
    };
    reload();
    const unsubs = storeKeys.map((key) => subscribeStoreTxnCashBreakdowns(key, reload));
    return () => {
      cancelled = true;
      for (const unsub of unsubs) unsub();
    };
  }, [idKey, storeKeysKey, storeKeys]);

  const savedKey = useMemo(
    () =>
      Object.entries(byId)
        .filter(([, sheet]) => sheet?.hasCount)
        .map(([id]) => id)
        .sort()
        .join(','),
    [byId],
  );

  const openEditor = useCallback((row) => {
    if (row) setEditorRow(row);
  }, []);

  const closeEditor = useCallback(() => {
    setEditorRow(null);
  }, []);

  const onSaved = useCallback((sheet) => {
    const id = sheet?.transactionId;
    if (!id) {
      setEditorRow(null);
      return;
    }
    setById((current) => {
      if (!sheet.hasCount) {
        if (!current[id]) return current;
        const next = { ...current };
        delete next[id];
        return next;
      }
      return { ...current, [id]: sheet };
    });
    setEditorRow(null);
  }, []);

  const isSaved = useCallback(
    (row) => Boolean(byId[cashBreakdownKey(row)]?.hasCount),
    [byId],
  );

  const sheetFor = useCallback((row) => byId[cashBreakdownKey(row)] || null, [byId]);

  return {
    byId,
    savedKey,
    editorRow,
    editorSheet: editorRow ? byId[cashBreakdownKey(editorRow)] || null : null,
    openEditor,
    closeEditor,
    onSaved,
    isSaved,
    sheetFor,
  };
}
