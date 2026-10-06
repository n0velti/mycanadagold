/**
 * Preview builds for "The Agent" Direct Message threads.
 *
 * One row per conversation (public.agent_builds). The proxy owns every
 * write; the app reads its own row, asks the proxy to start a build after
 * saving a request, and asks it to refresh while the build is baking.
 */
import { proxyJson } from './proxy';
import { getSupabase } from './supabase';

export const AGENT_BUILD_STATUSES = ['baking', 'ready', 'failed'];

const BUILD_COLUMNS =
  'conversation_id, sender_id, status, agent_id, agent_url, run_id, run_started_at, branch, pr_url, preview_url, summary, error, pending_request_id, last_request_id, replied_run_id, progress_note, progress_pct, tool_calls, publish_state, published_at, published_run_id, created_at, updated_at';
// Before the publish migration the table has no publish_* columns.
const BUILD_COLUMNS_NO_PUBLISH =
  'conversation_id, sender_id, status, agent_id, agent_url, run_id, run_started_at, branch, pr_url, preview_url, summary, error, pending_request_id, last_request_id, replied_run_id, progress_note, progress_pct, tool_calls, created_at, updated_at';
// Before the progress migration the table has no progress_* columns either.
const BUILD_COLUMNS_LEGACY =
  'conversation_id, sender_id, status, agent_id, agent_url, run_id, run_started_at, branch, pr_url, preview_url, summary, error, pending_request_id, last_request_id, replied_run_id, created_at, updated_at';

function asString(value) {
  if (value == null) return '';
  return String(value).trim();
}

function clampPct(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function isMissingRelation(error) {
  const code = String(error?.code || '');
  const message = String(error?.message || '');
  if (code === '42P01' || code === 'PGRST202' || code === 'PGRST205') return true;
  return /schema cache/i.test(message) && /agent_build/i.test(message);
}

export function mapAgentBuild(row) {
  if (!row) return null;
  const conversationId = asString(row.conversation_id || row.conversationId);
  if (!conversationId) return null;
  const status = asString(row.status) || 'baking';
  return {
    conversationId,
    senderId: asString(row.sender_id || row.senderId),
    status: AGENT_BUILD_STATUSES.includes(status) ? status : 'baking',
    agentId: asString(row.agent_id || row.agentId),
    agentUrl: asString(row.agent_url || row.agentUrl),
    runId: asString(row.run_id || row.runId),
    runStartedAt: row.run_started_at || row.runStartedAt || null,
    branch: asString(row.branch),
    prUrl: asString(row.pr_url || row.prUrl),
    previewUrl: asString(row.preview_url || row.previewUrl),
    summary: asString(row.summary),
    error: asString(row.error),
    hasQueuedFollowUp: Boolean(row.pending_request_id || row.pendingRequestId),
    lastRequestId: asString(row.last_request_id || row.lastRequestId),
    progressNote: asString(row.progress_note ?? row.progressNote),
    progressPct: clampPct(row.progress_pct ?? row.progressPct),
    toolCalls: Number(row.tool_calls ?? row.toolCalls ?? 0) || 0,
    publishState: asString(row.publish_state ?? row.publishState),
    publishedAt: row.published_at || row.publishedAt || null,
    publishedRunId: asString(row.published_run_id ?? row.publishedRunId),
    createdAt: row.created_at || row.createdAt || null,
    updatedAt: row.updated_at || row.updatedAt || null,
    localOnly: Boolean(row.localOnly),
  };
}

export function bakingBuild(conversationId, senderId) {
  const now = new Date().toISOString();
  return {
    conversationId,
    senderId: senderId || '',
    status: 'baking',
    agentId: '',
    agentUrl: '',
    runId: '',
    runStartedAt: now,
    branch: '',
    prUrl: '',
    previewUrl: '',
    summary: '',
    error: '',
    hasQueuedFollowUp: false,
    lastRequestId: '',
    progressNote: 'Sending to the agent',
    progressPct: 0,
    toolCalls: 0,
    publishState: '',
    publishedAt: null,
    publishedRunId: '',
    createdAt: now,
    updatedAt: now,
    localOnly: true,
  };
}

/** True once there is a preview the staff member can open, even mid-run. */
export function buildHasPreview(build) {
  return Boolean(build?.previewUrl) && (build.status === 'ready' || build.status === 'baking');
}

export function buildStatusLabel(build) {
  if (!build) return 'No preview yet';
  if (build.status === 'ready') return build.previewUrl ? 'Preview ready' : 'Done';
  if (build.status === 'failed') return 'Something went wrong';
  if (build.previewUrl) return 'Preview up, still baking';
  if (build.hasQueuedFollowUp) return 'Baking (follow-up queued)';
  return 'Baking';
}

/** Publish is for finished work with something pushed; a later edit clears publishState server-side. */
export function canPublishBuild(build) {
  if (!build || build.status !== 'ready') return false;
  if (!build.prUrl && !build.branch) return false;
  return build.publishState !== 'requested' && build.publishState !== 'published';
}

export function buildIsPublishRequested(build) {
  return Boolean(build) && (build.publishState === 'requested' || build.publishState === 'published');
}

/**
 * The DM a requester sends to the System Admins when they press Publish.
 * Plain text; links stay on their own lines so they are tappable.
 */
export function publishMessageText({ requesterName, requestText, build } = {}) {
  const who = asString(requesterName) || 'A staff member';
  const ask = asString(requestText).replace(/\s+/g, ' ').slice(0, 240);
  const lines = [`Publish request from ${who}${ask ? `: “${ask}”` : '.'}`];
  lines.push('They have reviewed the preview and are happy with it. Please push it to dev / main.');
  if (build?.previewUrl) lines.push(`Preview: ${build.previewUrl}`);
  if (build?.prUrl) lines.push(`Pull request: ${build.prUrl}`);
  else if (build?.branch) lines.push(`Branch: ${build.branch}`);
  if (build?.summary) lines.push(`Agent summary: ${asString(build.summary).slice(0, 400)}`);
  return lines.join('\n').slice(0, 4000);
}

/** One line for the thread header while the agent works, e.g. "Editing MessagesScreen.js · 45%". */
export function buildProgressLine(build) {
  if (!build || build.status !== 'baking') return '';
  const note = build.progressNote || (build.hasQueuedFollowUp ? 'Finishing the last message first' : 'Working');
  return `${note} · ${build.progressPct}%`;
}

export function buildStatusDetail(build) {
  if (!build) return 'Send a request and the agent will start baking a preview you can open here.';
  if (build.status === 'ready') {
    if (build.previewUrl) {
      return 'Open the preview to try the change. Keep messaging the agent to adjust it; the preview updates when it finishes.';
    }
    return 'The agent finished but there is no preview deployment for it yet. Check its reply in the chat.';
  }
  if (build.status === 'failed') {
    return build.error || 'The agent could not finish this one. Send another message to try again.';
  }
  if (build.hasQueuedFollowUp) {
    return 'The agent is still on your last message. Your newest one is queued and goes next.';
  }
  if (build.previewUrl) {
    return 'The agent is still working, but you can already open what it has pushed so far. It keeps updating until the agent finishes.';
  }
  return 'The agent is working on your request. This usually takes a few minutes; you can keep chatting.';
}

export async function listAgentBuilds() {
  const supabase = getSupabase();
  let lastError = null;
  for (const columns of [BUILD_COLUMNS, BUILD_COLUMNS_NO_PUBLISH, BUILD_COLUMNS_LEGACY]) {
    const { data, error } = await supabase
      .from('agent_builds')
      .select(columns)
      .order('updated_at', { ascending: false })
      .limit(100);
    if (!error) return (data || []).map(mapAgentBuild).filter(Boolean);
    lastError = error;
    if (isMissingRelation(error)) return [];
    if (!/progress_|tool_calls|publish/i.test(String(error.message || ''))) break;
  }
  throw new Error(lastError?.message || 'Could not load previews.');
}

/** Start (or follow up) the cloud agent for a saved request. Never throws; failures are reported as a build state. */
export async function startAgentBuild({ requestId, conversationId, senderId } = {}) {
  const id = asString(requestId);
  if (!id) return null;
  try {
    const payload = await proxyJson('agent/build/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId: id }),
    });
    return mapAgentBuild(payload?.build);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err || '');
    if (/not set up|not available/i.test(message)) return null;
    console.warn('agent build start', message);
    return {
      ...bakingBuild(asString(conversationId), senderId),
      status: 'failed',
      error: message || 'Could not start the agent.',
    };
  }
}

export async function refreshAgentBuild(conversationId) {
  const id = asString(conversationId);
  if (!id) return null;
  const payload = await proxyJson('agent/build/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conversationId: id }),
  });
  const build = mapAgentBuild(payload?.build);
  const warning = asString(payload?.warning);
  if (warning) console.warn('agent build refresh', warning);
  return build ? { ...build, syncWarning: warning } : build;
}

/** Flag the finished build for a System Admin to push live. Throws with a readable message. */
export async function publishAgentBuild(conversationId) {
  const id = asString(conversationId);
  if (!id) throw new Error('Open an agent conversation first.');
  const payload = await proxyJson('agent/build/publish', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conversationId: id }),
  });
  return mapAgentBuild(payload?.build);
}

export function subscribeAgentBuilds(onChange) {
  const supabase = getSupabase();
  const channel = supabase
    .channel(`agent-builds-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'agent_builds' }, () => {
      onChange?.();
    })
    .subscribe();
  return () => {
    supabase.removeChannel(channel);
  };
}
