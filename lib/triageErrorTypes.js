import { ERROR_TYPES, isListedErrorType } from './triageDraft';
import { getSupabase } from './supabase';

export function mergeErrorTypes(saved = []) {
  const seen = new Set();
  const labels = [];
  for (const raw of [...ERROR_TYPES, ...saved]) {
    const label = String(raw || '').trim();
    const key = label.toLowerCase();
    if (!isListedErrorType(label) || seen.has(key)) continue;
    seen.add(key);
    labels.push(label);
  }
  return labels;
}

export async function listTriageErrorTypes() {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('triage_error_types')
    .select('label')
    .order('label', { ascending: true });
  if (error) throw new Error(error.message || 'Could not load error types.');
  return mergeErrorTypes((data || []).map((row) => row.label));
}

export async function saveTriageErrorType(label) {
  const next = String(label || '').trim();
  if (!isListedErrorType(next)) throw new Error('Enter an error type.');
  const supabase = getSupabase();
  const { data: authData } = await supabase.auth.getUser();
  const { error } = await supabase.from('triage_error_types').upsert(
    { label: next, created_by: authData?.user?.id || null },
    { onConflict: 'label', ignoreDuplicates: true },
  );
  if (error) {
    if (!/duplicate|unique/i.test(error.message || '')) {
      throw new Error(error.message || 'Could not save that error type.');
    }
    const { data } = await supabase.from('triage_error_types').select('label').ilike('label', next).limit(1);
    return data?.[0]?.label || next;
  }
  return next;
}
