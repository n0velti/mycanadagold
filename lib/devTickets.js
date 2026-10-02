import { getSupabase } from './supabase';
import { proxyJson } from './proxy';

export const DEV_TICKET_STATUSES = {
  submitted: 'Queued',
  launching: 'Starting agent',
  in_progress: 'Agent working',
  ready: 'Ready to review',
  failed: 'Failed',
  approved: 'Approved',
  rejected: 'Rejected',
};

export function canReviewDevTickets(profile) {
  const role = String(profile?.appRole || '').trim();
  return Boolean(profile?.isSystemAdmin) || role === 'system_admin' || role === 'general_manager';
}

export function mapDevTicket(row) {
  if (!row?.id) return null;
  return {
    id: row.id,
    reporterId: row.reporter_id,
    title: row.title || '',
    body: row.body || '',
    status: row.status || 'submitted',
    agentId: row.agent_id || '',
    agentUrl: row.agent_url || '',
    runId: row.run_id || '',
    branch: row.branch || '',
    prUrl: row.pr_url || '',
    previewUrl: row.preview_url || '',
    agentSummary: row.agent_summary || '',
    error: row.error || '',
    decidedBy: row.decided_by,
    decidedAt: row.decided_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listDevTickets() {
  const { data, error } = await getSupabase()
    .from('dev_tickets')
    .select(
      'id, reporter_id, title, body, status, agent_id, agent_url, run_id, branch, pr_url, preview_url, agent_summary, error, decided_by, decided_at, created_at, updated_at',
    )
    .order('created_at', { ascending: false })
    .limit(40);
  if (error) throw new Error(error.message || 'Could not load tickets.');
  return (data || []).map(mapDevTicket).filter(Boolean);
}

export async function createDevTicket(body) {
  const text = String(body || '').trim();
  if (!text) throw new Error('Write what you want fixed.');
  const { data, error } = await getSupabase()
    .from('dev_tickets')
    .insert({ body: text })
    .select(
      'id, reporter_id, title, body, status, agent_id, agent_url, run_id, branch, pr_url, preview_url, agent_summary, error, decided_by, decided_at, created_at, updated_at',
    )
    .single();
  if (error) throw new Error(error.message || 'Could not create that ticket.');
  return mapDevTicket(data);
}

export async function launchDevTicket(ticketId) {
  return proxyJson('dev-tickets/launch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ticketId }),
  });
}

export async function refreshDevTicket(ticketId) {
  return proxyJson('dev-tickets/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ticketId }),
  });
}

export async function decideDevTicket(ticketId, action) {
  return proxyJson('dev-tickets/decide', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ticketId, action }),
  });
}

export function subscribeDevTickets(onChange) {
  const supabase = getSupabase();
  const channel = supabase
    .channel(`dev-tickets-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'dev_tickets' }, () => {
      onChange?.();
    })
    .subscribe();
  return () => {
    supabase.removeChannel(channel);
  };
}
