import { getSupabase } from './supabase';

export const NOTE_CATEGORIES = [
  { key: 'general', label: 'General' },
  { key: 'follow_up', label: 'Follow-up' },
  { key: 'task', label: 'Task' },
  { key: 'hr', label: 'HR' },
  { key: 'performance', label: 'Performance' },
  { key: 'personal', label: 'Personal' },
];

export const NOTE_IMPORTANCE = [
  { key: 'low', label: 'Low' },
  { key: 'medium', label: 'Medium' },
  { key: 'high', label: 'High' },
  { key: 'urgent', label: 'Urgent' },
];

const CATEGORY_KEYS = new Set(NOTE_CATEGORIES.map((row) => row.key));
const IMPORTANCE_KEYS = new Set(NOTE_IMPORTANCE.map((row) => row.key));

function asString(value) {
  if (value == null) return '';
  return String(value).trim();
}

function isMissingRelation(error) {
  const code = String(error?.code || '');
  const message = String(error?.message || '');
  if (code === '42P01' || code === 'PGRST202' || code === 'PGRST205') return true;
  return /schema cache/i.test(message) && /profile_notes|add_profile_note/i.test(message);
}

function describeError(error, action = 'load notes') {
  if (!error) return `Could not ${action}.`;
  if (isMissingRelation(error)) {
    return 'Run the profile notes SQL in Supabase, then refresh.';
  }
  return error.message || `Could not ${action}.`;
}

function throwQueryError(error, action) {
  const wrapped = new Error(describeError(error, action));
  wrapped.code = error?.code;
  wrapped.missing = isMissingRelation(error);
  throw wrapped;
}

export function sanitizeNoteCategory(value) {
  const next = asString(value).toLowerCase();
  return CATEGORY_KEYS.has(next) ? next : 'general';
}

export function sanitizeNoteImportance(value) {
  const next = asString(value).toLowerCase();
  return IMPORTANCE_KEYS.has(next) ? next : 'medium';
}

export function noteCategoryLabel(value) {
  const key = sanitizeNoteCategory(value);
  return NOTE_CATEGORIES.find((row) => row.key === key)?.label || 'General';
}

export function noteImportanceLabel(value) {
  const key = sanitizeNoteImportance(value);
  return NOTE_IMPORTANCE.find((row) => row.key === key)?.label || 'Medium';
}

export function mapProfileNote(row) {
  if (!row?.id) return null;
  return {
    id: row.id,
    profileId: row.profile_id || row.profileId,
    authorId: row.author_id || row.authorId,
    authorName: asString(row.author_name || row.authorName) || 'Teammate',
    body: asString(row.body),
    dueOn: asString(row.due_on || row.dueOn) || '',
    category: sanitizeNoteCategory(row.category),
    importance: sanitizeNoteImportance(row.importance),
    createdAt: row.created_at || row.createdAt,
  };
}

export function formatNoteDate(value) {
  if (!value) return '—';
  const raw = String(value);
  const date = raw.length <= 10 ? new Date(`${raw}T00:00:00`) : new Date(raw);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

const NOTE_COLUMNS = 'id, profile_id, author_id, author_name, body, due_on, category, importance, created_at';

export async function listProfileNotes(profileId) {
  const id = asString(profileId);
  if (!id) return [];

  const { data, error } = await getSupabase()
    .from('profile_notes')
    .select(NOTE_COLUMNS)
    .eq('profile_id', id)
    .order('created_at', { ascending: false });

  if (error) throwQueryError(error, 'load notes');
  return (data || []).map(mapProfileNote).filter(Boolean);
}

export async function addProfileNote(profileId, fields) {
  const id = asString(profileId);
  const body = asString(fields?.body);
  if (!id) throw new Error('Choose a profile first.');
  if (!body) throw new Error('Type a note first.');

  const { data, error } = await getSupabase().rpc('add_profile_note', {
    p_profile_id: id,
    p_body: body,
    p_due_on: asString(fields?.dueOn) || null,
    p_category: sanitizeNoteCategory(fields?.category),
    p_importance: sanitizeNoteImportance(fields?.importance),
  });

  if (error) throwQueryError(error, 'save that note');
  const mapped = mapProfileNote(data);
  if (!mapped) throw new Error('Could not save that note.');
  return mapped;
}

export async function deleteProfileNote(noteId) {
  const id = asString(noteId);
  if (!id) return;

  const { error } = await getSupabase().from('profile_notes').delete().eq('id', id);
  if (error) throwQueryError(error, 'delete that note');
}
