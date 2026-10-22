import { getSupabase } from './supabase';
import { formatDateParam, parseDateParam } from './transactions';

export const CANCEL_STEP_ORDER = [
  'cancel_requested',
  'funds_not_cleared',
  'ready_to_cancel',
  'cancelled',
];

export const CANCEL_STEP_LABELS = {
  cancel_requested: 'Cancel requested',
  funds_not_cleared: 'Funds not cleared',
  ready_to_cancel: 'Ready to cancel',
  cancelled: 'Cancelled',
};

export function nextCancelButtonLabel(step) {
  if (!step) return 'Cancel';
  if (step === 'cancel_requested') return 'Funds Not Cleared';
  if (step === 'funds_not_cleared') return 'Ready to Cancel';
  if (step === 'ready_to_cancel') return 'Cancelled';
  return null;
}

export function staffDisplayName(session) {
  const profile = session?.profile;
  const fromProfile =
    profile?.fullName ||
    [profile?.firstName, profile?.lastName].filter(Boolean).join(' ').trim();
  if (fromProfile) return fromProfile;
  return session?.login || 'Staff';
}

function staffUserId(session) {
  return session?.supabaseUserId || session?.profile?.id || null;
}

function isMissingRelation(error) {
  const code = String(error?.code || '');
  const message = String(error?.message || '');
  if (code === '42P01' || code === 'PGRST205') return true;
  return /schema cache/i.test(message) && /accounting_payment_cancellations/i.test(message);
}

function normalizeRow(row) {
  if (!row) return null;
  const timeline = Array.isArray(row.timeline) ? row.timeline : [];
  return {
    paymentKey: row.payment_key,
    step: row.step || '',
    note: row.note || '',
    timeline,
    updatedAt: row.updated_at || '',
  };
}

export async function fetchPaymentCancellations(paymentKeys) {
  const keys = [...new Set((paymentKeys || []).filter(Boolean))];
  if (keys.length === 0) return {};

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('accounting_payment_cancellations')
    .select('payment_key, step, note, timeline, updated_at')
    .in('payment_key', keys);

  if (error) {
    if (isMissingRelation(error)) return {};
    throw error;
  }

  const map = {};
  for (const row of data || []) {
    const normalized = normalizeRow(row);
    if (normalized) map[normalized.paymentKey] = normalized;
  }
  return map;
}

function appendTimelineEntry(timeline, step, session) {
  const entry = {
    step,
    label: CANCEL_STEP_LABELS[step] || step,
    at: new Date().toISOString(),
    user_id: staffUserId(session),
    user_name: staffDisplayName(session),
  };
  return [...(Array.isArray(timeline) ? timeline : []), entry];
}

export async function advancePaymentCancellation(payment, session, currentRecord) {
  const supabase = getSupabase();
  const userId = staffUserId(session);
  if (!userId) {
    throw new Error('Sign in again to update the cancel workflow.');
  }

  const paymentKey = payment.id;
  const currentStep = currentRecord?.step || '';
  let nextStep = '';
  if (!currentStep) nextStep = 'cancel_requested';
  else if (currentStep === 'cancel_requested') nextStep = 'funds_not_cleared';
  else if (currentStep === 'funds_not_cleared') nextStep = 'ready_to_cancel';
  else if (currentStep === 'ready_to_cancel') nextStep = 'cancelled';
  else {
    throw new Error('This payment is already cancelled.');
  }

  const timeline = appendTimelineEntry(currentRecord?.timeline || [], nextStep, session);
  const paymentDate = formatDateParam(parseDateParam(payment.date || payment.dateLabel));

  const payload = {
    payment_key: paymentKey,
    system_key: payment.systemKey || '',
    source_id: Number(payment.sourceId) || 0,
    store_name: payment.storeName || '',
    payment_date: paymentDate,
    step: nextStep,
    note: currentRecord?.note || '',
    timeline,
    updated_at: new Date().toISOString(),
    updated_by: userId,
  };

  const { data, error } = await supabase
    .from('accounting_payment_cancellations')
    .upsert(payload, { onConflict: 'payment_key' })
    .select('payment_key, step, note, timeline, updated_at')
    .maybeSingle();

  if (error) {
    if (isMissingRelation(error)) {
      throw new Error('Run Supabase migrations for accounting payment cancellations, then refresh.');
    }
    throw error;
  }

  return normalizeRow(data);
}

export async function savePaymentCancellationNote(paymentKey, note, session) {
  const supabase = getSupabase();
  const userId = staffUserId(session);
  if (!userId) {
    throw new Error('Sign in again to save the note.');
  }

  const { data, error } = await supabase
    .from('accounting_payment_cancellations')
    .update({
      note: String(note || ''),
      updated_at: new Date().toISOString(),
      updated_by: userId,
    })
    .eq('payment_key', paymentKey)
    .select('payment_key, step, note, timeline, updated_at')
    .maybeSingle();

  if (error) {
    if (isMissingRelation(error)) {
      throw new Error('Run Supabase migrations for accounting payment cancellations, then refresh.');
    }
    throw error;
  }

  return normalizeRow(data);
}

export function buildCancelTimelineView(record) {
  if (!record) {
    return CANCEL_STEP_ORDER.map((step) => ({
      step,
      label: CANCEL_STEP_LABELS[step] || step,
      status: 'pending',
      at: '',
      userName: '',
      isCurrent: false,
    }));
  }

  const timeline = Array.isArray(record?.timeline) ? record.timeline : [];
  const byStep = new Map();
  for (const entry of timeline) {
    if (entry?.step && !byStep.has(entry.step)) byStep.set(entry.step, entry);
  }

  const current = record?.step || '';
  const currentIndex = CANCEL_STEP_ORDER.indexOf(current);

  return CANCEL_STEP_ORDER.map((step, index) => {
    const entry = byStep.get(step);
    let status = 'pending';
    if (entry) status = 'done';
    else if (current && index === currentIndex + 1) status = 'next';
    else if (current && index <= currentIndex && !entry) status = 'skipped';

    return {
      step,
      label: CANCEL_STEP_LABELS[step] || step,
      status,
      at: entry?.at || '',
      userName: entry?.user_name || '',
      isCurrent: step === current,
    };
  });
}
