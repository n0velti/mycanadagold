/**
 * Company instructions for Analytics and Messages AI chat. A System Admin or
 * General Manager writes them in Settings → AI models. Every signed-in
 * employee can read them so the next question follows the text.
 */
import { getSupabase } from './supabase';

const TABLE = 'company_ai_instructions';

export const AI_INSTRUCTION_LIMIT = 4000;

export const AI_INSTRUCTION_ASSISTANTS = [
  {
    key: 'analytics',
    label: 'Analytics',
    description:
      'Added to every Analytics answer. Say how it should sound, and when to add a chart even if nobody asked.',
    placeholder:
      'Whenever a line, bar, or pie chart would help, add the one that fits the question, even if the user does not ask.',
  },
  {
    key: 'chat',
    label: 'AI chat',
    description: 'Added to every AI chat in Messages. Say how it should sound and what to emphasize.',
    placeholder: 'Keep answers short. Lead with the number, then one sentence of context.',
  },
];

const ASSISTANT_KEYS = new Set(AI_INSTRUCTION_ASSISTANTS.map((item) => item.key));

export function emptyAiInstructions() {
  return Object.fromEntries(AI_INSTRUCTION_ASSISTANTS.map((item) => [item.key, '']));
}

export function sanitizeAiInstruction(value) {
  return String(value || '')
    .replace(/\u0000/g, '')
    .trim()
    .slice(0, AI_INSTRUCTION_LIMIT);
}

function isMissingRelation(error) {
  const code = String(error?.code || '');
  const message = String(error?.message || '');
  if (code === '42P01' || code === 'PGRST205') return true;
  return /schema cache/i.test(message) && /company_ai_instructions/i.test(message);
}

function isPermissionError(error) {
  const code = String(error?.code || '');
  const message = String(error?.message || '');
  return code === '42501' || code === 'PGRST301' || /permission denied|row-level security/i.test(message);
}

function describeError(error, action = 'load') {
  if (!error) return `Could not ${action} AI instructions.`;
  if (isMissingRelation(error)) {
    return 'Run the AI instructions SQL in Supabase, including the schema reload line, then refresh.';
  }
  if (error.code === 'NO_SESSION') return error.message;
  if (isPermissionError(error)) {
    return action === 'save'
      ? 'Only a System Admin or General Manager can change AI instructions.'
      : 'No permission to load AI instructions. Sign out and sign in again, then retry.';
  }
  return error.message || `Could not ${action} AI instructions.`;
}

async function requireClient() {
  const supabase = getSupabase();
  const { data } = await supabase.auth.getSession();
  if (!data?.session?.user?.id) {
    const error = new Error('Sign out and sign in again so AI instructions can load.');
    error.code = 'NO_SESSION';
    throw error;
  }
  return supabase;
}

function instructionsFromRows(rows) {
  const next = emptyAiInstructions();
  for (const row of rows || []) {
    const assistant = String(row?.assistant || '').trim();
    if (!ASSISTANT_KEYS.has(assistant)) continue;
    next[assistant] = sanitizeAiInstruction(row?.instructions);
  }
  return next;
}

/**
 * Settings editor. Throws when the table is missing or the user cannot read it.
 */
export async function loadAiInstructionState() {
  try {
    const supabase = await requireClient();
    const { data, error } = await supabase.from(TABLE).select('assistant, instructions');
    if (error) throw error;
    return { instructions: instructionsFromRows(data), unavailable: false };
  } catch (error) {
    if (isMissingRelation(error)) {
      return { instructions: emptyAiInstructions(), unavailable: true };
    }
    throw new Error(describeError(error, 'load'));
  }
}

/**
 * One assistant's text for a prompt. Missing table or a failed read returns ''
 * so a question still goes through.
 */
export async function loadAiInstruction(assistant) {
  const key = String(assistant || '').trim();
  if (!ASSISTANT_KEYS.has(key)) return '';
  try {
    const supabase = await requireClient();
    const { data, error } = await supabase
      .from(TABLE)
      .select('instructions')
      .eq('assistant', key)
      .maybeSingle();
    if (error) throw error;
    return sanitizeAiInstruction(data?.instructions);
  } catch {
    return '';
  }
}

export async function saveAiInstructions(instructions) {
  const sanitized = emptyAiInstructions();
  for (const assistant of ASSISTANT_KEYS) {
    sanitized[assistant] = sanitizeAiInstruction(instructions?.[assistant]);
  }
  const supabase = await requireClient();
  const { data: authData } = await supabase.auth.getSession();
  const actorId = authData?.session?.user?.id || null;
  const now = new Date().toISOString();
  const rows = [...ASSISTANT_KEYS].map((assistant) => ({
    assistant,
    instructions: sanitized[assistant],
    updated_at: now,
    updated_by: actorId,
  }));
  const { error } = await supabase.from(TABLE).upsert(rows, { onConflict: 'assistant' });
  if (error) throw new Error(describeError(error, 'save'));
  return sanitized;
}

/**
 * Appends Settings text to a prompt. Chart and wording choices in that text
 * win over the built-in defaults. Figures still have to come from real data.
 */
export function appendCompanyInstructions(prompt, instructions, { figuresFrom } = {}) {
  const text = sanitizeAiInstruction(instructions);
  if (!text) return prompt;
  const figures = figuresFrom
    ? ` Every figure still has to come from ${figuresFrom}. These instructions do not allow invented numbers.`
    : '';
  return `${prompt}\n\nCompany instructions from Settings. Follow these for tone and for how to shape the answer, including when to add a chart, table, or map. If they disagree with earlier rules about charts or wording, follow these.${figures}\n${text}`;
}
