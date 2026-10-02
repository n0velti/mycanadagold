import { hasFullAppAccess } from './permissions';
import { proxyJson } from './proxy';
import { getSupabase } from './supabase';

const TABLE = 'company_cursor_settings';

function isMissingRelation(error) {
  const code = String(error?.code || '');
  const message = String(error?.message || '');
  if (code === '42P01' || code === 'PGRST205') return true;
  return /schema cache/i.test(message) && message.includes(TABLE);
}

function isPermissionError(error) {
  const code = String(error?.code || '');
  const message = String(error?.message || '');
  return code === '42501' || code === 'PGRST301' || /permission denied|row-level security/i.test(message);
}

function describeError(error, action = 'load') {
  if (!error) return `Could not ${action} the Cursor agent model.`;
  if (isMissingRelation(error)) {
    return 'Run the latest Supabase migration, then refresh.';
  }
  if (error.code === 'NO_SESSION') return error.message;
  if (isPermissionError(error)) {
    return 'Only a System Admin can change the Cursor agent model.';
  }
  return error.message || `Could not ${action} the Cursor agent model.`;
}

export function canManageCursorAgentModel(profile) {
  return hasFullAppAccess(profile);
}

export function normalizeCursorAgentModel(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, '')
    .slice(0, 80);
}

export async function loadCursorAgentModel() {
  const supabase = getSupabase();
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData?.session?.user?.id) {
    const error = new Error('Sign out and sign in again so this setting can load.');
    error.code = 'NO_SESSION';
    throw error;
  }
  const { data, error } = await supabase
    .from(TABLE)
    .select('agent_model')
    .eq('id', 1)
    .maybeSingle();
  if (error) {
    if (isMissingRelation(error)) return { model: '', unavailable: true };
    throw new Error(describeError(error, 'load'));
  }
  return { model: normalizeCursorAgentModel(data?.agent_model), unavailable: false };
}

export async function saveCursorAgentModel(model, userId) {
  const next = normalizeCursorAgentModel(model);
  const supabase = getSupabase();
  const { data: sessionData } = await supabase.auth.getSession();
  const actorId = sessionData?.session?.user?.id || userId || null;
  if (!actorId) {
    const error = new Error('Sign out and sign in again so this setting can save.');
    error.code = 'NO_SESSION';
    throw error;
  }
  const { data, error } = await supabase
    .from(TABLE)
    .upsert(
      {
        id: 1,
        agent_model: next,
        updated_at: new Date().toISOString(),
        updated_by: actorId,
      },
      { onConflict: 'id' },
    )
    .select('agent_model')
    .maybeSingle();
  if (error) throw new Error(describeError(error, 'save'));
  return { model: normalizeCursorAgentModel(data?.agent_model), unavailable: false };
}

export async function listCursorAgentModels() {
  try {
    const payload = await proxyJson('dev-tickets/models', { method: 'GET' });
    const models = Array.isArray(payload?.models) ? payload.models : [];
    return models
      .map((row) => normalizeCursorAgentModel(row?.id || row))
      .filter(Boolean);
  } catch {
    return [];
  }
}
