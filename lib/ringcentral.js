import { canManageStoreSettings, storeKeyFromName } from './storeSettings';
import { getSupabase } from './supabase';
import { ProxyError, proxyJson } from './proxy';

const ACCOUNT_SELECT =
  'id, store_key, store_name, server_url, account_id, company_name, main_number, extension_count, last_status, last_error, last_checked_at, created_at, updated_at, has_client_id, has_secret, has_jwt';

export const RINGCENTRAL_SERVERS = [
  {
    key: 'https://platform.ringcentral.com',
    label: 'Production',
  },
  {
    key: 'https://platform.devtest.ringcentral.com',
    label: 'Sandbox',
  },
];

function asString(value) {
  if (value == null) return '';
  return String(value).trim();
}

function isMissingRelation(error) {
  const code = String(error?.code || '');
  const message = String(error?.message || '');
  if (code === '42P01' || code === 'PGRST205') return true;
  return /schema cache/i.test(message) && /ringcentral_accounts/i.test(message);
}

function isPermissionError(error) {
  const code = String(error?.code || '');
  const message = String(error?.message || '');
  return code === '42501' || code === 'PGRST301' || /permission denied|row-level security/i.test(message);
}

function describeError(error, action = 'load') {
  if (!error) return `Could not ${action} RingCentral data.`;
  if (isMissingRelation(error)) {
    return 'Run the Phone / RingCentral SQL in Supabase, including the schema reload line, then refresh.';
  }
  if (error.code === 'NO_SESSION') return error.message;
  if (isPermissionError(error)) {
    return action === 'save'
      ? 'No permission to change RingCentral credentials. Branch managers and above can edit them.'
      : 'No permission to load phone accounts. Sign out and sign in again, then retry.';
  }
  return error.message || `Could not ${action} RingCentral data.`;
}

async function requireClient() {
  const supabase = getSupabase();
  const { data } = await supabase.auth.getSession();
  if (!data?.session?.user?.id) {
    const error = new Error('Sign out and sign in again so phone accounts can load.');
    error.code = 'NO_SESSION';
    throw error;
  }
  return supabase;
}

export function canManageRingCentral(profile) {
  return canManageStoreSettings(profile);
}

export function connectionLabel(row) {
  if (!row) return 'Not connected';
  if (row.lastStatus === 'connected') return 'Connected';
  if (row.lastStatus === 'error') return 'Error';
  if (row.hasJwt && row.hasClientId && row.hasSecret) return 'Saved';
  if (row.hasClientId || row.hasSecret) return 'Needs JWT';
  return 'Not connected';
}

export function mapRingCentralAccount(row) {
  if (!row) return null;
  return {
    id: row.id,
    storeKey: row.store_key || row.storeKey || '',
    storeName: row.store_name || row.storeName || '',
    serverUrl: row.server_url || row.serverUrl || RINGCENTRAL_SERVERS[0].key,
    accountId: row.account_id || row.accountId || '',
    companyName: row.company_name || row.companyName || '',
    mainNumber: row.main_number || row.mainNumber || '',
    extensionCount: Number(row.extension_count ?? row.extensionCount) || 0,
    lastStatus: row.last_status || row.lastStatus || '',
    lastError: row.last_error || row.lastError || '',
    lastCheckedAt: row.last_checked_at || row.lastCheckedAt || null,
    hasClientId: Boolean(row.has_client_id ?? row.hasClientId),
    hasSecret: Boolean(row.has_secret ?? row.hasSecret),
    hasJwt: Boolean(row.has_jwt ?? row.hasJwt),
    createdAt: row.created_at || row.createdAt || null,
    updatedAt: row.updated_at || row.updatedAt || null,
  };
}

async function listFromSupabase() {
  const supabase = await requireClient();
  const { data, error } = await supabase
    .from('ringcentral_accounts')
    .select(ACCOUNT_SELECT)
    .order('store_name');
  if (error) throw error;
  return (data || []).map(mapRingCentralAccount).filter(Boolean);
}

export async function listRingCentralAccounts() {
  try {
    const payload = await proxyJson('ringcentral/stores');
    const rows = Array.isArray(payload?.stores) ? payload.stores : [];
    return { rows: rows.map(mapRingCentralAccount).filter(Boolean), unavailable: false };
  } catch (error) {
    if (error instanceof ProxyError && (error.code === 'not_found' || error.status === 404)) {
      try {
        return { rows: await listFromSupabase(), unavailable: false };
      } catch (fallback) {
        if (isMissingRelation(fallback)) return { rows: [], unavailable: true };
        throw new Error(describeError(fallback, 'load'));
      }
    }
    try {
      return { rows: await listFromSupabase(), unavailable: false };
    } catch (fallback) {
      if (isMissingRelation(fallback)) return { rows: [], unavailable: true };
      if (error instanceof ProxyError) throw error;
      throw new Error(describeError(fallback, 'load'));
    }
  }
}

export async function saveRingCentralAccount(values, userId) {
  const storeName = asString(values?.storeName);
  if (!storeName) throw new Error('Choose a store.');

  const supabase = await requireClient();
  const { data: authData } = await supabase.auth.getSession();
  const actorId = authData?.session?.user?.id || userId || null;
  const serverUrl = RINGCENTRAL_SERVERS.some((entry) => entry.key === values?.serverUrl)
    ? values.serverUrl
    : RINGCENTRAL_SERVERS[0].key;

  const row = {
    store_key: storeKeyFromName(storeName),
    store_name: storeName,
    server_url: serverUrl,
    updated_at: new Date().toISOString(),
    updated_by: actorId,
  };

  const clientId = asString(values?.clientId);
  const clientSecret = asString(values?.clientSecret);
  const jwt = asString(values?.jwt).replace(/\s+/g, '');
  if (clientId) row.client_id = clientId;
  if (clientSecret) row.client_secret = clientSecret;
  if (jwt) row.jwt = jwt;

  if (!values?.id && !clientId) throw new Error('Paste the RingCentral client ID.');
  if (!values?.id && !clientSecret) throw new Error('Paste the RingCentral client secret.');
  if (!values?.id && !jwt) throw new Error('Paste the RingCentral JWT credential.');

  const writer = values?.id
    ? supabase.from('ringcentral_accounts').update(row).eq('id', values.id)
    : supabase.from('ringcentral_accounts').upsert(row, { onConflict: 'store_key' });

  const { data, error } = await writer.select(ACCOUNT_SELECT).maybeSingle();
  if (error) throw new Error(describeError(error, 'save'));
  if (!data) throw new Error('The RingCentral account could not be saved.');
  return mapRingCentralAccount(data);
}

export async function deleteRingCentralAccount(id) {
  const accountId = asString(id);
  if (!accountId) throw new Error('Missing account.');
  const supabase = await requireClient();
  const { error } = await supabase.from('ringcentral_accounts').delete().eq('id', accountId);
  if (error) throw new Error(describeError(error, 'save'));
}

export async function checkRingCentralAccount(storeKey) {
  const key = storeKeyFromName(storeKey);
  if (!key) throw new Error('Choose a store to check.');
  const payload = await proxyJson('ringcentral/check', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ storeKey: key }),
  });
  return mapRingCentralAccount(payload?.store || payload);
}

export function formatPhoneNumber(value) {
  const digits = asString(value).replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+1 ${digits.slice(1, 4)} ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return asString(value) || '—';
}

export function formatCheckedAt(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('en-CA', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
