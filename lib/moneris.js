import { canManageStoreSettings, storeKeyFromName } from './storeSettings';
import { getSupabase } from './supabase';
import { formatAmount, formatDateParam, parseDateParam } from './transactions';
import { proxyJson } from './proxy';

export const MONERIS_ENVIRONMENTS = [
  {
    key: 'core',
    label: 'Core Cloud (Move 5000)',
    hint: 'patpos.moneris.com — Cloud via Wi-Fi on a Core terminal',
  },
  {
    key: 'production',
    label: 'Go Cloud (production)',
    hint: 'ippos.moneris.com — newer Go Cloud 3.0 devices',
  },
  {
    key: 'qa',
    label: 'Go Cloud (QA)',
    hint: 'ippostest.moneris.com — Moneris test host',
  },
];

const TERMINAL_SELECT =
  'id, store_key, store_name, label, terminal_id, store_id, environment, ist_config_code, lan_ip, last_seen_at, last_status, last_error, created_at, updated_at';

function asString(value) {
  if (value == null) return '';
  return String(value).trim();
}

function isMissingRelation(error) {
  const code = String(error?.code || '');
  const message = String(error?.message || '');
  if (code === '42P01' || code === 'PGRST205') return true;
  return /schema cache/i.test(message) && /moneris_/i.test(message);
}

function isPermissionError(error) {
  const code = String(error?.code || '');
  const message = String(error?.message || '');
  return code === '42501' || code === 'PGRST301' || /permission denied|row-level security/i.test(message);
}

function describeError(error, action = 'load') {
  if (!error) return `Could not ${action} Moneris data.`;
  if (isMissingRelation(error)) {
    return 'Run the Debit / Moneris SQL in Supabase, including the schema reload line, then refresh.';
  }
  if (error.code === 'NO_SESSION') return error.message;
  if (isPermissionError(error)) {
    return action === 'save'
      ? 'No permission to change terminals. Branch managers and above can edit them.'
      : 'No permission to load debit terminals. Sign out and sign in again, then retry.';
  }
  return error.message || `Could not ${action} Moneris data.`;
}

async function requireClient() {
  const supabase = getSupabase();
  const { data } = await supabase.auth.getSession();
  if (!data?.session?.user?.id) {
    const error = new Error('Sign out and sign in again so debit terminals can load.');
    error.code = 'NO_SESSION';
    throw error;
  }
  return supabase;
}

export function canManageMonerisTerminals(profile) {
  return canManageStoreSettings(profile);
}

export function environmentLabel(key) {
  return MONERIS_ENVIRONMENTS.find((entry) => entry.key === key)?.label || 'Core Cloud (Move 5000)';
}

function mapTerminal(row) {
  if (!row) return null;
  return {
    id: row.id,
    storeKey: row.store_key || '',
    storeName: row.store_name || '',
    label: row.label || '',
    terminalId: row.terminal_id || '',
    storeId: row.store_id || '',
    environment: row.environment || 'core',
    istConfigCode: row.ist_config_code || '',
    lanIp: row.lan_ip || '',
    lastSeenAt: row.last_seen_at || null,
    lastStatus: row.last_status || '',
    lastError: row.last_error || '',
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    displayName: row.label || row.terminal_id || 'Move 5000',
  };
}

function mapReceipt(row) {
  if (!row) return null;
  const amount = Number(row.amount) || 0;
  const approved = Boolean(row.approved);
  const action = asString(row.action) || 'purchase';
  const type = action === 'refund' || action === 'purchase_correction' ? 'Out' : 'In';
  return {
    id: row.id,
    source: 'moneris',
    terminalRef: row.terminal_id_ref || null,
    storeKey: row.store_key || '',
    storeName: row.store_name || '',
    terminalId: row.terminal_id || '',
    orderId: row.order_id || '',
    cloudTicket: row.cloud_ticket || '',
    action,
    type,
    directionLabel: type === 'In' ? 'Received' : 'Paid out',
    amount,
    amountLabel: formatAmount(amount, row.currency || 'CAD'),
    currency: row.currency || 'CAD',
    cardType: row.card_type || '',
    cardLast4: row.card_last4 || '',
    authCode: row.auth_code || '',
    responseCode: row.response_code || '',
    approved,
    date: row.transacted_on || '',
    dateLabel: row.transacted_on || '',
    transactedAt: row.transacted_at || null,
    paymentType: row.card_type || 'Terminal',
    customerName: row.card_type
      ? [row.card_type, row.card_last4 ? `••••${row.card_last4}` : ''].filter(Boolean).join(' ')
      : 'Terminal',
    reference: row.order_id || '—',
    searchText: [
      row.store_name,
      row.terminal_id,
      row.order_id,
      row.card_type,
      row.card_last4,
      row.auth_code,
      action,
    ]
      .join(' ')
      .toLowerCase(),
  };
}

export async function listMonerisTerminals(storeName) {
  try {
    const supabase = await requireClient();
    let query = supabase.from('moneris_terminals').select(TERMINAL_SELECT).order('store_name');
    if (storeName) query = query.eq('store_key', storeKeyFromName(storeName));
    const { data, error } = await query;
    if (error) throw error;
    return { rows: (data || []).map(mapTerminal).filter(Boolean), unavailable: false };
  } catch (error) {
    if (isMissingRelation(error)) return { rows: [], unavailable: true };
    throw new Error(describeError(error, 'load'));
  }
}

export async function saveMonerisTerminal(values, userId) {
  const storeName = asString(values?.storeName);
  const terminalId = asString(values?.terminalId);
  const storeId = asString(values?.storeId);
  if (!storeName) throw new Error('Choose a store.');
  if (!terminalId) throw new Error('Enter the terminal ID from the Move 5000.');
  if (!storeId) throw new Error('Enter the Moneris store ID from Merchant Direct.');

  const environment = MONERIS_ENVIRONMENTS.some((entry) => entry.key === values?.environment)
    ? values.environment
    : 'core';

  const supabase = await requireClient();
  const { data: authData } = await supabase.auth.getSession();
  const actorId = authData?.session?.user?.id || userId || null;
  const row = {
    store_key: storeKeyFromName(storeName),
    store_name: storeName,
    label: asString(values?.label),
    terminal_id: terminalId,
    store_id: storeId,
    environment,
    ist_config_code: asString(values?.istConfigCode),
    lan_ip: asString(values?.lanIp),
    updated_at: new Date().toISOString(),
    updated_by: actorId,
  };
  const token = asString(values?.apiToken);
  if (token) row.api_token = token;
  if (!values?.id && !token) {
    throw new Error('Paste the Cloud API token from Merchant Direct.');
  }

  const writer = values?.id
    ? supabase.from('moneris_terminals').update(row).eq('id', values.id)
    : supabase.from('moneris_terminals').insert(row);

  const { data, error } = await writer.select(TERMINAL_SELECT).maybeSingle();
  if (error) throw new Error(describeError(error, 'save'));
  if (!data) throw new Error('The terminal could not be saved.');
  return mapTerminal(data);
}

export async function deleteMonerisTerminal(id) {
  const terminalId = asString(id);
  if (!terminalId) throw new Error('Missing terminal.');
  const supabase = await requireClient();
  const { error } = await supabase.from('moneris_terminals').delete().eq('id', terminalId);
  if (error) throw new Error(describeError(error, 'save'));
}

export async function listMonerisTransactions({ date, storeName } = {}) {
  try {
    const supabase = await requireClient();
    const day = formatDateParam(parseDateParam(date || new Date()));
    let query = supabase
      .from('moneris_transactions')
      .select(
        'id, terminal_id_ref, store_key, store_name, terminal_id, order_id, cloud_ticket, action, amount, currency, card_type, card_last4, auth_code, response_code, approved, transacted_on, transacted_at',
      )
      .eq('transacted_on', day)
      .order('transacted_at', { ascending: false });
    if (storeName) query = query.eq('store_key', storeKeyFromName(storeName));
    const { data, error } = await query;
    if (error) throw error;
    return { rows: (data || []).map(mapReceipt).filter(Boolean), unavailable: false };
  } catch (error) {
    if (isMissingRelation(error)) return { rows: [], unavailable: true };
    throw new Error(describeError(error, 'load'));
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function sendMonerisCloud({
  terminalId,
  action = 'purchase',
  amount,
  orderId,
  txnNumber,
  poll = true,
} = {}) {
  const first = await proxyJson('moneris/cloud', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      terminalId,
      action,
      amount,
      orderId,
      txnNumber,
    }),
  });

  let current = first;
  const receiptUrl = first?.receiptUrl;
  if (poll && receiptUrl && !first?.completed) {
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline && !current?.completed) {
      await sleep(2500);
      current = await proxyJson('moneris/poll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ receiptUrl, terminalId }),
      });
    }
  }

  return current;
}

export function summarizeTerminalRows(rows) {
  let debitIn = 0;
  let debitOut = 0;
  let inCount = 0;
  let outCount = 0;
  let approved = 0;

  for (const row of rows || []) {
    if (!row.approved) continue;
    approved += 1;
    if (row.type === 'In') {
      debitIn += row.amount;
      inCount += 1;
    } else {
      debitOut += row.amount;
      outCount += 1;
    }
  }

  return {
    count: (rows || []).length,
    approved,
    debitIn,
    debitOut,
    net: debitIn - debitOut,
    inCount,
    outCount,
  };
}
