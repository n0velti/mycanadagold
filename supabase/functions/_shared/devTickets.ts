import { error, json, readJson } from './http.ts';
import { adminClient, type StaffContext } from './staff.ts';

const CURSOR_API = 'https://api.cursor.com/v1';
const GITHUB_API = 'https://api.github.com';
const VERCEL_API = 'https://api.vercel.com';

const REVIEW_ROLES = new Set(['system_admin', 'general_manager']);

type TicketRow = {
  id: string;
  reporter_id: string;
  title: string;
  body: string;
  status: string;
  agent_id: string;
  agent_url: string;
  run_id: string;
  branch: string;
  pr_url: string;
  preview_url: string;
  agent_summary: string;
  error: string;
};

export function env(name: string, fallback = ''): string {
  return String(Deno.env.get(name) || fallback).trim();
}

function canReview(staff: StaffContext): boolean {
  return staff.isSystemAdmin || REVIEW_ROLES.has(staff.appRole);
}

async function loadTicket(id: string): Promise<TicketRow | null> {
  const { data, error: queryError } = await adminClient()
    .from('dev_tickets')
    .select(
      'id, reporter_id, title, body, status, agent_id, agent_url, run_id, branch, pr_url, preview_url, agent_summary, error',
    )
    .eq('id', id)
    .maybeSingle();
  if (queryError) throw new Error(queryError.message);
  return (data as TicketRow | null) || null;
}

async function patchTicket(id: string, fields: Record<string, unknown>): Promise<TicketRow> {
  const { data, error: queryError } = await adminClient()
    .from('dev_tickets')
    .update(fields)
    .eq('id', id)
    .select(
      'id, reporter_id, title, body, status, agent_id, agent_url, run_id, branch, pr_url, preview_url, agent_summary, error',
    )
    .single();
  if (queryError) throw new Error(queryError.message);
  return data as TicketRow;
}

function cursorHeaders(): HeadersInit {
  const key = env('CURSOR_API_KEY');
  if (!key) throw new Error('CURSOR_API_KEY is not set on the Edge Function.');
  return {
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
  };
}

export class CursorApiError extends Error {
  status: number;
  code: string;
  constructor(message: string, status: number, code = '') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function cursorJson(path: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  const response = await fetch(`${CURSOR_API}${path}`, {
    ...init,
    headers: { ...cursorHeaders(), ...(init.headers || {}) },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const typed = payload as { message?: string; code?: string; error?: { message?: string; code?: string } };
    const message = typed?.error?.message || typed?.message || `Cursor API failed (${response.status}).`;
    throw new CursorApiError(message, response.status, String(typed?.error?.code || typed?.code || ''));
  }
  return payload as Record<string, unknown>;
}

export function firstBranch(payload: Record<string, unknown>): { branch: string; prUrl: string } {
  const git = payload.git as { branches?: Array<{ branch?: string; prUrl?: string }> } | undefined;
  const item = git?.branches?.[0];
  return {
    branch: String(item?.branch || ''),
    prUrl: String(item?.prUrl || ''),
  };
}

export async function resolveAgentModel(): Promise<string> {
  try {
    const { data } = await adminClient()
      .from('company_cursor_settings')
      .select('agent_model')
      .eq('id', 1)
      .maybeSingle();
    const saved = String((data as { agent_model?: string } | null)?.agent_model || '').trim();
    if (saved) return saved;
  } catch {
    // Table missing or unread: fall through to the Edge Function secret.
  }
  return env('CURSOR_AGENT_MODEL');
}

function agentPrompt(ticket: TicketRow): string {
  return [
    'You are working on MyCanadaGold (`cgold`), the Canada Gold staff app.',
    'Read AGENTS.md and https://docs.expo.dev/versions/v54.0.0/ before changing Expo code.',
    'Expo SDK 54, React 19.1, React Native 0.81. JavaScript screens in components/, logic in lib/.',
    'Third-party HTTP goes through the proxy Edge Function. Do not add an api/ directory.',
    'Do not merge to main, change Vercel project settings, or weaken auth / RLS.',
    'Implement only this ticket on a new branch. Keep the change scoped.',
    'Open a pull request that describes what changed and how to verify it. Do not merge it.',
    '',
    `Ticket id: ${ticket.id}`,
    `Title: ${ticket.title}`,
    '',
    ticket.body,
  ].join('\n');
}

export type VercelDeployment = {
  /** Newest READY deployment for the branch (empty until one exists). */
  readyUrl: string;
  /** Newest deployment for the branch regardless of state. */
  latestUrl: string;
  /** State of the newest deployment for the branch, e.g. BUILDING / READY / ERROR. */
  latestState: string;
  /** True when Vercel has no deployment for the branch yet. */
  none: boolean;
};

/**
 * Narrow the branch's deployments to the ones that can be "the" preview for
 * a run. `commitSha` keeps only deployments of that commit; `since` (ms)
 * keeps only deployments created after the run started. With neither, the
 * newest deployment on the branch wins.
 */
export type VercelDeploymentMatch = { commitSha?: string; since?: number };

export async function vercelDeployment(
  branch: string,
  match: VercelDeploymentMatch = {},
): Promise<VercelDeployment> {
  const empty: VercelDeployment = { readyUrl: '', latestUrl: '', latestState: '', none: true };
  const token = env('VERCEL_TOKEN');
  const projectId = env('VERCEL_PROJECT_ID');
  if (!token || !projectId || !branch) return empty;
  const teamId = env('VERCEL_TEAM_ID');
  // The filter param is `branch`; `gitBranch` is silently ignored and the list
  // becomes every branch's deployments, so the "preview" opens someone else's build.
  const query = new URLSearchParams({
    projectId,
    branch,
    limit: '10',
  });
  if (teamId) query.set('teamId', teamId);
  const response = await fetch(`${VERCEL_API}/v6/deployments?${query}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) return empty;
  type DeploymentRow = {
    url?: string;
    readyState?: string;
    state?: string;
    created?: number;
    createdAt?: number;
    meta?: {
      githubCommitRef?: string;
      gitlabCommitRef?: string;
      bitbucketCommitRef?: string;
      githubCommitSha?: string;
      gitlabCommitSha?: string;
      bitbucketCommitSha?: string;
    };
  };
  const all = Array.isArray((payload as { deployments?: unknown[] }).deployments)
    ? (payload as { deployments: DeploymentRow[] }).deployments
    : [];
  // Belt and braces: never hand back a deployment from another branch.
  const refOf = (row: DeploymentRow) =>
    String(row.meta?.githubCommitRef || row.meta?.gitlabCommitRef || row.meta?.bitbucketCommitRef || '');
  const shaOf = (row: DeploymentRow) =>
    String(row.meta?.githubCommitSha || row.meta?.gitlabCommitSha || row.meta?.bitbucketCommitSha || '').toLowerCase();
  const createdOf = (row: DeploymentRow) => Number(row.createdAt || row.created || 0);
  const wantSha = String(match.commitSha || '').toLowerCase();
  const since = Number(match.since || 0);
  const deployments = all.filter((row) => {
    if (refOf(row) && refOf(row) !== branch) return false;
    if (wantSha && shaOf(row) !== wantSha) return false;
    if (since && createdOf(row) && createdOf(row) < since) return false;
    return true;
  });
  if (!deployments.length) return empty;
  const stateOf = (row: { readyState?: string; state?: string }) =>
    String(row.readyState || row.state || '').toUpperCase();
  const toUrl = (row?: { url?: string }) => {
    const host = String(row?.url || '').replace(/^https?:\/\//, '');
    return host ? `https://${host}` : '';
  };
  const ready = deployments.find((row) => stateOf(row) === 'READY');
  return {
    readyUrl: toUrl(ready),
    latestUrl: toUrl(deployments[0]),
    latestState: stateOf(deployments[0]),
    none: false,
  };
}

async function vercelPreview(branch: string): Promise<string> {
  const deployment = await vercelDeployment(branch);
  return deployment.readyUrl || deployment.latestUrl;
}

function parseGithubPr(prUrl: string): { owner: string; repo: string; number: string } | null {
  const match = String(prUrl || '').match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/i);
  if (!match) return null;
  return { owner: match[1], repo: match[2], number: match[3] };
}

async function githubJson(path: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  const token = env('GITHUB_TOKEN');
  if (!token) throw new Error('GITHUB_TOKEN is not set on the Edge Function.');
  const response = await fetch(`${GITHUB_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      (payload as { message?: string }).message || `GitHub API failed (${response.status}).`;
    throw new Error(message);
  }
  return payload as Record<string, unknown>;
}

function parseGithubRepo(repoUrl: string): { owner: string; repo: string } | null {
  const match = String(repoUrl || '').match(/github\.com[/:]([^/]+)\/([^/#?]+?)(?:\.git)?\/?$/i);
  if (!match) return null;
  return { owner: match[1], repo: match[2] };
}

/**
 * Commit the branch currently points at, or '' when GitHub is not
 * configured / reachable or the repo is not on GitHub. Used to make sure a
 * preview deployment really is the agent's final push and not an older one.
 */
export async function githubBranchHeadSha(repoUrl: string, branch: string): Promise<string> {
  const parsed = parseGithubRepo(repoUrl);
  if (!parsed || !branch || !env('GITHUB_TOKEN')) return '';
  try {
    // Agent branches look like cursor/foo-1a2b; GitHub wants the slash kept.
    const path = branch.split('/').map(encodeURIComponent).join('/');
    const payload = await githubJson(`/repos/${parsed.owner}/${parsed.repo}/branches/${path}`);
    const commit = (payload.commit || {}) as { sha?: string };
    return String(commit.sha || '').toLowerCase();
  } catch {
    return '';
  }
}

async function syncAgent(ticket: TicketRow): Promise<TicketRow> {
  if (!ticket.agent_id) return ticket;
  const agent = await cursorJson(`/agents/${encodeURIComponent(ticket.agent_id)}`);
  const runId = String(ticket.run_id || agent.latestRunId || '');
  let run: Record<string, unknown> = {};
  if (runId) {
    run = await cursorJson(`/agents/${encodeURIComponent(ticket.agent_id)}/runs/${encodeURIComponent(runId)}`);
  }
  const git = firstBranch(run);
  const previewUrl = git.branch ? await vercelPreview(git.branch) : ticket.preview_url;
  const runStatus = String(run.status || '').toUpperCase();
  const agentStatus = String(agent.status || '').toUpperCase();
  let status = ticket.status;
  if (git.prUrl) status = ticket.status === 'approved' || ticket.status === 'rejected' ? ticket.status : 'ready';
  else if (runStatus === 'ERROR' || runStatus === 'EXPIRED') status = 'failed';
  else if (runStatus === 'FINISHED' && !git.prUrl) status = 'in_progress';
  else if (agentStatus === 'ACTIVE' || runStatus === 'RUNNING' || runStatus === 'CREATING') status = 'in_progress';

  return patchTicket(ticket.id, {
    run_id: runId,
    agent_url: String(agent.url || ticket.agent_url || ''),
    branch: git.branch || ticket.branch,
    pr_url: git.prUrl || ticket.pr_url,
    preview_url: previewUrl || ticket.preview_url,
    agent_summary: String(run.result || ticket.agent_summary || '').slice(0, 4000),
    status,
    error: status === 'failed' ? String(run.result || 'The agent run failed.').slice(0, 1000) : '',
  });
}

export async function handleDevTicketModels(req: Request, staff: StaffContext): Promise<Response> {
  if (!staff.isSystemAdmin) {
    return error(req, 403, 'Only a system admin can list Cursor models.', 'forbidden');
  }
  try {
    const payload = await cursorJson('/models');
    const raw = Array.isArray(payload.models)
      ? payload.models
      : Array.isArray(payload.items)
        ? payload.items
        : [];
    const models = raw
      .map((row) => {
        if (typeof row === 'string') return { id: row };
        const id = String((row as { id?: string }).id || '').trim();
        return id ? { id } : null;
      })
      .filter(Boolean);
    return json(req, 200, { models });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not list Cursor models.';
    return json(req, 200, { models: [], error: message });
  }
}

export async function handleDevTicketLaunch(req: Request, staff: StaffContext): Promise<Response> {
  const body = await readJson<{ ticketId?: string }>(req);
  const ticketId = String(body.ticketId || '').trim();
  if (!ticketId) return error(req, 400, 'Missing ticket.', 'bad_request');

  const ticket = await loadTicket(ticketId);
  if (!ticket) return error(req, 404, 'Ticket not found.', 'not_found');
  if (ticket.agent_id) {
    const synced = await syncAgent(ticket);
    return json(req, 200, { ticket: synced });
  }

  await patchTicket(ticket.id, { status: 'launching', error: '' });

  const repoUrl = env('CURSOR_REPO_URL', 'https://github.com/n0velti/mycanadagold');
  const startingRef = env('CURSOR_REPO_REF', 'dev');
  const modelId = await resolveAgentModel();

  try {
    const created = await cursorJson('/agents', {
      method: 'POST',
      body: JSON.stringify({
        prompt: { text: agentPrompt(ticket) },
        name: ticket.title.slice(0, 100) || 'Staff ticket',
        repos: [{ url: repoUrl, startingRef }],
        autoCreatePR: true,
        skipReviewerRequest: true,
        ...(modelId ? { model: { id: modelId } } : {}),
      }),
    });
    const agent = (created.agent || created) as Record<string, unknown>;
    const run = (created.run || {}) as Record<string, unknown>;
    const saved = await patchTicket(ticket.id, {
      status: 'in_progress',
      agent_id: String(agent.id || ''),
      agent_url: String(agent.url || ''),
      run_id: String(run.id || agent.latestRunId || ''),
      error: '',
    });
    return json(req, 200, { ticket: saved });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not start the agent.';
    const failed = await patchTicket(ticket.id, { status: 'failed', error: message.slice(0, 1000) });
    return json(req, 200, { ticket: failed });
  }
}

export async function handleDevTicketRefresh(req: Request, _staff: StaffContext): Promise<Response> {
  const body = await readJson<{ ticketId?: string }>(req);
  const ticketId = String(body.ticketId || '').trim();
  if (!ticketId) return error(req, 400, 'Missing ticket.', 'bad_request');
  const ticket = await loadTicket(ticketId);
  if (!ticket) return error(req, 404, 'Ticket not found.', 'not_found');
  try {
    const synced = ticket.agent_id ? await syncAgent(ticket) : ticket;
    return json(req, 200, { ticket: synced });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not refresh that ticket.';
    const failed = await patchTicket(ticket.id, { error: message.slice(0, 1000) });
    return json(req, 200, { ticket: failed });
  }
}

export async function handleDevTicketDecide(req: Request, staff: StaffContext): Promise<Response> {
  if (!canReview(staff)) {
    return error(req, 403, 'Only a system admin or general manager can approve tickets.', 'forbidden');
  }
  const body = await readJson<{ ticketId?: string; action?: string }>(req);
  const ticketId = String(body.ticketId || '').trim();
  const action = String(body.action || '').trim().toLowerCase();
  if (!ticketId || (action !== 'approve' && action !== 'reject')) {
    return error(req, 400, 'Choose approve or reject.', 'bad_request');
  }
  const ticket = await loadTicket(ticketId);
  if (!ticket) return error(req, 404, 'Ticket not found.', 'not_found');
  if (ticket.status === 'approved' || ticket.status === 'rejected') {
    return json(req, 200, { ticket });
  }

  const parsed = parseGithubPr(ticket.pr_url);
  if (parsed) {
    if (action === 'approve') {
      await githubJson(`/repos/${parsed.owner}/${parsed.repo}/pulls/${parsed.number}/merge`, {
        method: 'PUT',
        body: JSON.stringify({
          merge_method: 'squash',
          commit_title: ticket.title || 'Approve staff ticket',
        }),
      });
    } else {
      await githubJson(`/repos/${parsed.owner}/${parsed.repo}/pulls/${parsed.number}`, {
        method: 'PATCH',
        body: JSON.stringify({ state: 'closed' }),
      });
      if (ticket.agent_id && ticket.run_id) {
        await cursorJson(
          `/agents/${encodeURIComponent(ticket.agent_id)}/runs/${encodeURIComponent(ticket.run_id)}/cancel`,
          { method: 'POST' },
        ).catch(() => null);
      }
    }
  } else if (action === 'approve') {
    return error(req, 400, 'The agent has not opened a pull request yet.', 'bad_request');
  }

  const saved = await patchTicket(ticket.id, {
    status: action === 'approve' ? 'approved' : 'rejected',
    decided_by: staff.userId,
    decided_at: new Date().toISOString(),
    error: '',
  });
  return json(req, 200, { ticket: saved });
}
