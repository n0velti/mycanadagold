/**
 * "The Agent" Direct Message → Cursor cloud agent → Vercel preview.
 *
 * One cloud agent per DM conversation (public.agent_builds). The first
 * message creates the agent; later messages become follow-up runs on the
 * same agent so the branch (and its Vercel preview) keeps updating. The
 * requesting staff member only reads their build row; every write here is
 * the service role. Cursor / Vercel / GitHub keys stay in function secrets.
 */
import { error, json, readJson } from './http.ts';
import { adminClient, type StaffContext } from './staff.ts';
import {
  CursorApiError,
  cursorJson,
  env,
  firstBranch,
  githubBranchHeadSha,
  resolveAgentModel,
  vercelDeployment,
  type VercelDeploymentMatch,
} from './devTickets.ts';

const BUILD_COLUMNS =
  'conversation_id, sender_id, status, agent_id, agent_url, run_id, run_started_at, branch, pr_url, preview_url, summary, error, pending_prompt, pending_request_id, last_request_id, replied_run_id, progress_note, progress_pct, tool_calls, stream_cursor, publish_state, published_at, published_run_id, created_at, updated_at';

const CURSOR_API = 'https://api.cursor.com/v1';
/** How long one poll may listen to the run stream before giving the row back. */
const STREAM_TAP_MS = 2_500;
// A single run replays thousands of events (most are interaction_update noise); parsing is cheap.
const STREAM_TAP_MAX_EVENTS = 4_000;

const REQUEST_COLUMNS = 'id, conversation_id, sender_id, body, image_urls, status, approval_state, created_at';

/** Finished run with no Vercel deployment after this long → stop waiting. */
const DEPLOY_WAIT_MS = 10 * 60 * 1000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type BuildRow = {
  conversation_id: string;
  sender_id: string;
  status: 'baking' | 'ready' | 'failed';
  agent_id: string;
  agent_url: string;
  run_id: string;
  run_started_at: string | null;
  branch: string;
  pr_url: string;
  preview_url: string;
  summary: string;
  error: string;
  pending_prompt: string;
  pending_request_id: string | null;
  last_request_id: string | null;
  replied_run_id: string;
  progress_note: string;
  progress_pct: number;
  tool_calls: number;
  stream_cursor: string;
  publish_state: '' | 'requested' | 'published';
  published_at: string | null;
  published_run_id: string;
  created_at: string;
  updated_at: string;
};

type RequestRow = {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  image_urls: string[];
  status: string;
  approval_state: string;
  created_at: string;
};

function requestImages(request: RequestRow): string[] {
  const urls = Array.isArray(request.image_urls) ? request.image_urls : [];
  return urls.map((url) => String(url || '').trim()).filter(Boolean).slice(0, 4);
}

function promptWithImages(body: string, images: string[]): string {
  const text = String(body || '').trim();
  if (!images.length) return text;
  const lines = images.map((url, index) => `${index + 1}. ${url}`);
  return [
    text,
    '',
    'Reference images from the requester (screenshots / mockups — open the URLs):',
    ...lines,
  ]
    .filter(Boolean)
    .join('\n');
}

function isMissingTable(message: string): boolean {
  return /schema cache|does not exist|agent_builds/i.test(message);
}

async function loadBuild(conversationId: string): Promise<BuildRow | null> {
  const { data, error: queryError } = await adminClient()
    .from('agent_builds')
    .select(BUILD_COLUMNS)
    .eq('conversation_id', conversationId)
    .maybeSingle();
  if (queryError) throw new Error(queryError.message);
  return (data as BuildRow | null) || null;
}

/**
 * Update the conversation's row, inserting it when it does not exist yet.
 * Not an upsert: Postgres checks NOT NULL (sender_id) on the proposed row
 * before resolving the conflict, so an upsert without sender_id fails even
 * for plain updates.
 */
async function saveBuild(conversationId: string, fields: Record<string, unknown>): Promise<BuildRow> {
  const admin = adminClient();
  const updated = await admin
    .from('agent_builds')
    .update(fields)
    .eq('conversation_id', conversationId)
    .select(BUILD_COLUMNS)
    .maybeSingle();
  if (updated.error) throw new Error(updated.error.message);
  if (updated.data) return updated.data as BuildRow;
  if (!fields.sender_id) throw new Error('Build row is missing; cannot create it without a sender.');
  const inserted = await admin
    .from('agent_builds')
    .insert({ conversation_id: conversationId, ...fields })
    .select(BUILD_COLUMNS)
    .single();
  if (inserted.error) throw new Error(inserted.error.message);
  return inserted.data as BuildRow;
}

async function loadRequest(requestId: string): Promise<RequestRow | null> {
  const { data, error: queryError } = await adminClient()
    .from('agent_requests')
    .select(REQUEST_COLUMNS)
    .eq('id', requestId)
    .maybeSingle();
  if (queryError) throw new Error(queryError.message);
  return (data as RequestRow | null) || null;
}

async function setRequestStatus(requestId: string, status: 'in_progress' | 'done'): Promise<void> {
  const { error: queryError } = await adminClient()
    .from('agent_requests')
    .update({ status })
    .eq('id', requestId)
    .neq('status', status);
  if (queryError) console.error('agent build request status', queryError.message);
}

/** Everything the finished run was asked to do → done. Later messages stay in progress. */
async function finishRequests(conversationId: string, before: string | null): Promise<void> {
  let query = adminClient()
    .from('agent_requests')
    .update({ status: 'done' })
    .eq('conversation_id', conversationId)
    .eq('status', 'in_progress');
  if (before) query = query.lte('created_at', before);
  const { error: queryError } = await query;
  if (queryError) console.error('agent build finish requests', queryError.message);
}

/** A line from the agent in the thread. 'reply' is the run's final message; 'status' is housekeeping. */
async function postThreadEvent(
  build: BuildRow,
  requestId: string | null,
  text: string,
  kind: 'reply' | 'status',
  createdBy: string | null = null,
): Promise<void> {
  const body = String(text || '').trim().slice(0, 1200);
  if (!body || !requestId) return;
  const request = await loadRequest(requestId);
  if (!request) return;
  const { error: queryError } = await adminClient().from('agent_request_events').insert({
    request_id: request.id,
    conversation_id: build.conversation_id,
    body,
    status: kind === 'reply' ? 'done' : request.status || 'new',
    approval_state: request.approval_state || 'pending_review',
    kind,
    created_by: createdBy,
  });
  if (queryError) console.error('agent build thread event', queryError.message);
}

async function postReply(build: BuildRow, requestId: string | null, text: string): Promise<void> {
  return postThreadEvent(build, requestId, text, 'reply');
}

async function senderName(userId: string): Promise<string> {
  try {
    const { data } = await adminClient()
      .from('profiles')
      .select('full_name, first_name, last_name')
      .eq('id', userId)
      .maybeSingle();
    const row = (data || {}) as { full_name?: string; first_name?: string; last_name?: string };
    const full = String(row.full_name || '').trim();
    if (full) return full;
    return [row.first_name, row.last_name].map((part) => String(part || '').trim()).filter(Boolean).join(' ');
  } catch {
    return '';
  }
}

const REPLY_STYLE =
  'Your final message is shown to that staff member inside the chat. Write it for a non-developer: ' +
  'one to three short sentences on what changed and what to look at in the preview. ' +
  'If the request is unclear, ask one concise question instead of guessing.';

function firstPrompt(body: string, name: string, images: string[]): string {
  return [
    'You are working on MyCanadaGold (`cgold`), the Canada Gold staff app.',
    'Read AGENTS.md and https://docs.expo.dev/versions/v54.0.0/ before changing Expo code.',
    'Expo SDK 54, React 19.1, React Native 0.81. JavaScript screens in components/, logic in lib/.',
    'Third-party HTTP goes through the proxy Edge Function. Do not add an api/ directory.',
    'Do not merge to main, change Vercel project settings, or weaken auth / RLS.',
    '',
    'This is a conversation with a staff member in the app\u2019s Direct Messages. Follow-up messages',
    'come from the same person refining the same request. Keep every change on this one branch so',
    'the Vercel preview for the branch keeps updating. Open a pull request and do not merge it.',
    REPLY_STYLE,
    '',
    `Request${name ? ` from ${name}` : ''}:`,
    promptWithImages(body, images),
  ].join('\n');
}

function followUpPrompt(body: string, name: string, images: string[]): string {
  return [
    `Follow-up${name ? ` from ${name}` : ''} on the same request. Keep working on this branch and update the pull request.`,
    REPLY_STYLE,
    '',
    promptWithImages(body, images),
  ].join('\n');
}

async function createAgent(build: BuildRow | null, request: RequestRow, prompt: string): Promise<BuildRow> {
  const repoUrl = env('CURSOR_REPO_URL', 'https://github.com/n0velti/mycanadagold');
  const startingRef = env('CURSOR_REPO_REF', 'dev');
  const modelId = await resolveAgentModel();
  const created = await cursorJson('/agents', {
    method: 'POST',
    body: JSON.stringify({
      prompt: { text: prompt },
      name: request.body.replace(/\s+/g, ' ').trim().slice(0, 100) || 'Staff request',
      repos: [{ url: repoUrl, startingRef }],
      autoCreatePR: true,
      skipReviewerRequest: true,
      ...(modelId ? { model: { id: modelId } } : {}),
    }),
  });
  const agent = (created.agent || created) as Record<string, unknown>;
  const run = (created.run || {}) as Record<string, unknown>;
  return saveBuild(request.conversation_id, {
    sender_id: request.sender_id,
    status: 'baking',
    agent_id: String(agent.id || ''),
    agent_url: String(agent.url || ''),
    run_id: String(run.id || agent.latestRunId || ''),
    run_started_at: new Date().toISOString(),
    branch: '',
    pr_url: '',
    preview_url: '',
    summary: '',
    error: '',
    pending_prompt: '',
    pending_request_id: null,
    last_request_id: request.id,
    replied_run_id: build?.replied_run_id || '',
    ...FRESH_RUN_PROGRESS,
  });
}

/** Progress + publish fields reset whenever a new run starts. */
const FRESH_RUN_PROGRESS = {
  progress_note: 'Starting up',
  progress_pct: 0,
  tool_calls: 0,
  stream_cursor: '',
  publish_state: '',
};

/** Follow-up run on the existing agent. Busy agent → queue it for the next sync. */
async function followUp(build: BuildRow, requestId: string | null, prompt: string): Promise<BuildRow> {
  try {
    const created = await cursorJson(`/agents/${encodeURIComponent(build.agent_id)}/runs`, {
      method: 'POST',
      body: JSON.stringify({ prompt: { text: prompt } }),
    });
    const run = (created.run || created) as Record<string, unknown>;
    return saveBuild(build.conversation_id, {
      status: 'baking',
      run_id: String(run.id || ''),
      run_started_at: new Date().toISOString(),
      // The old preview is the app before this message; hide it until the new run has deployed.
      preview_url: '',
      error: '',
      pending_prompt: '',
      pending_request_id: null,
      last_request_id: requestId || build.last_request_id,
      ...FRESH_RUN_PROGRESS,
    });
  } catch (err) {
    if (err instanceof CursorApiError && err.status === 409) {
      const pending = [build.pending_prompt, prompt].filter(Boolean).join('\n\n').slice(0, 16000);
      return saveBuild(build.conversation_id, {
        status: 'baking',
        preview_url: '',
        error: '',
        pending_prompt: pending,
        pending_request_id: requestId || build.pending_request_id,
      });
    }
    throw err;
  }
}

function terminal(status: string): boolean {
  return status === 'FINISHED' || status === 'ERROR' || status === 'EXPIRED' || status === 'CANCELLED';
}

// ---------------------------------------------------------------------------
// Live progress from the run stream
// ---------------------------------------------------------------------------

type StreamTap = { note: string; toolCalls: number; cursor: string };

function baseName(value: unknown): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return '';
  return text.split(/[\\/]/).filter(Boolean).pop() || '';
}

function pathFromArgs(args: unknown): string {
  if (!args || typeof args !== 'object') return '';
  const record = args as Record<string, unknown>;
  for (const key of ['path', 'file_path', 'target_file', 'relative_workspace_path', 'target_directory']) {
    const found = baseName(record[key]);
    if (found) return found;
  }
  return '';
}

/** Plain-language line for a tool call, e.g. "Editing MessagesScreen.js". */
function describeToolCall(name: string, args: unknown): string {
  let tool = String(name || '').toLowerCase();
  // MCP wrappers carry the real tool in args.toolName (WebFetch, TodoWrite, …).
  if (/mcp/.test(tool) && args && typeof args === 'object') {
    const inner = String((args as Record<string, unknown>).toolName || '').trim();
    if (inner) tool = inner.toLowerCase();
  }
  const file = pathFromArgs(args);
  const withFile = (verb: string) => (file ? `${verb} ${file}` : verb);
  if (/^(read_file|view|cat|head|tail)$/.test(tool)) return withFile('Reading');
  if (/todo|plan/.test(tool)) return 'Planning the work';
  if (/pr_management|^gh$/.test(tool)) return 'Opening the pull request';
  if (/^git$/.test(tool)) return 'Saving changes to the branch';
  if (/lint|^test$|^npm$|^npx$|^node$/.test(tool)) return 'Checking the code';
  if (/edit|write|replace|patch|apply|create|^cp$|^mv$|mkdir/.test(tool)) return withFile('Editing');
  if (/delete|remove|^rm$/.test(tool)) return withFile('Removing');
  if (/grep|search|glob|find|^rg$/.test(tool)) return 'Searching the code';
  if (/^(list_dir|ls|tree)$/.test(tool)) return 'Looking through the code';
  if (/web|fetch|browse|http|chrome/.test(tool)) return 'Checking a web page';
  if (/mcp|cursor-cloud|message-queue/.test(tool)) return 'Using a tool';
  if (/terminal|shell|command|bash|exec|run|echo|python|which|kill/.test(tool)) return 'Running a command';
  return 'Working';
}

function cleanNote(text: string): string {
  const flat = text.replace(/[`*_#>]/g, '').replace(/\s+/g, ' ').trim();
  if (!flat) return '';
  const sentences = flat.split(/(?<=[.!?])\s+/).filter(Boolean);
  const last = sentences[sentences.length - 1] || flat;
  return last.length > 140 ? `${last.slice(0, 137).trimEnd()}…` : last;
}

/**
 * Listen to the run's SSE stream for a moment, resuming from the saved
 * cursor, and fold what happened into a note + tool-call count. Returns null
 * when the stream is unavailable (expired, auth, network) so the caller keeps
 * the previous note.
 */
export async function tapRunStream(build: BuildRow, runId: string): Promise<StreamTap | null> {
  const key = env('CURSOR_API_KEY');
  if (!key || !build.agent_id || !runId) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), STREAM_TAP_MS);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${key}`,
    Accept: 'text/event-stream',
  };
  if (build.stream_cursor) headers['Last-Event-ID'] = build.stream_cursor;

  let response: Response;
  try {
    response = await fetch(
      `${CURSOR_API}/agents/${encodeURIComponent(build.agent_id)}/runs/${encodeURIComponent(runId)}/stream`,
      { headers, signal: controller.signal },
    );
  } catch {
    clearTimeout(timer);
    return null;
  }
  if (!response.ok || !response.body) {
    clearTimeout(timer);
    await response.body?.cancel().catch(() => undefined);
    // 400 invalid_last_event_id: the cursor belongs to another run — start over next time.
    if (response.status === 400 && build.stream_cursor) {
      return { note: build.progress_note, toolCalls: build.tool_calls, cursor: '' };
    }
    return null;
  }

  let note = build.progress_note || '';
  let toolCalls = Number(build.tool_calls || 0);
  let cursor = build.stream_cursor || '';
  let assistantBuffer = '';
  let events = 0;
  let pendingId = '';
  let pendingEvent = '';
  let pendingData: string[] = [];

  const flush = () => {
    if (!pendingEvent && !pendingData.length) return;
    const event = pendingEvent || 'message';
    const raw = pendingData.join('\n');
    let data: Record<string, unknown> = {};
    try {
      data = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    } catch {
      data = {};
    }
    if (pendingId) cursor = pendingId;
    events += 1;
    if ((event === 'assistant' || event === 'thinking') && typeof data.text === 'string') {
      assistantBuffer = `${assistantBuffer}${data.text}`.slice(-600);
      const line = cleanNote(assistantBuffer);
      if (line) note = line;
    } else if (event === 'tool_call') {
      if (data.status === 'completed') toolCalls += 1;
      if (data.status === 'running') {
        assistantBuffer = '';
        note = describeToolCall(String(data.name || ''), data.args);
      }
    } else if (event === 'result' && typeof data.text === 'string' && data.text.trim()) {
      note = cleanNote(data.text);
    }
    pendingId = '';
    pendingEvent = '';
    pendingData = [];
  };

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let leftover = '';
  try {
    while (events < STREAM_TAP_MAX_EVENTS) {
      const { value, done } = await reader.read();
      if (done) break;
      const text = leftover + value;
      const lines = text.split(/\r?\n/);
      leftover = lines.pop() || '';
      for (const line of lines) {
        if (line === '') {
          flush();
          continue;
        }
        if (line.startsWith(':')) continue;
        const sep = line.indexOf(':');
        const field = sep < 0 ? line : line.slice(0, sep);
        const value = sep < 0 ? '' : line.slice(sep + 1).replace(/^ /, '');
        if (field === 'id') pendingId = value;
        else if (field === 'event') pendingEvent = value;
        else if (field === 'data') pendingData.push(value);
      }
    }
  } catch {
    // Aborted by the timer or the connection dropped — keep what we have.
  } finally {
    clearTimeout(timer);
    await reader.cancel().catch(() => undefined);
  }
  flush();
  return { note: note.slice(0, 200), toolCalls, cursor: cursor.slice(0, 120) };
}

/**
 * 0-100 from milestones, never moving backwards within one run:
 * starting → working (grows with tool calls) → pushed → PR → preview building → finished.
 * The preview URL itself is only written once the finished run's commit is READY on Vercel.
 */
function progressPercent(input: {
  previous: number;
  runStatus: string;
  toolCalls: number;
  branch: string;
  prUrl: string;
  deployState: string;
  finished: boolean;
}): number {
  let pct = 0;
  if (input.runStatus === 'CREATING') pct = 5;
  else pct = Math.min(55, 15 + Math.round(input.toolCalls * 1.5));
  if (input.branch) pct = Math.max(pct, 60);
  if (input.prUrl) pct = Math.max(pct, 70);
  if (input.deployState === 'BUILDING' || input.deployState === 'QUEUED' || input.deployState === 'INITIALIZING') {
    pct = Math.max(pct, 80);
  }
  // The settled "ready" paths write 100 themselves; a finished run still waiting on Vercel sits at 95.
  if (input.finished) pct = Math.max(pct, 95);
  return Math.max(0, Math.min(100, Math.max(input.previous || 0, pct)));
}

/** Pull the latest run + Vercel state and settle the build row. */
async function syncBuild(build: BuildRow): Promise<BuildRow> {
  if (!build.agent_id) return build;
  const agent = await cursorJson(`/agents/${encodeURIComponent(build.agent_id)}`);
  const runId = String(build.run_id || agent.latestRunId || '');
  let run: Record<string, unknown> = {};
  if (runId) {
    run = await cursorJson(`/agents/${encodeURIComponent(build.agent_id)}/runs/${encodeURIComponent(runId)}`);
  }
  const git = firstBranch(run);
  const runStatus = String(run.status || '').toUpperCase();
  const agentStatus = String(agent.status || '').toUpperCase();
  const result = String(run.result || '').trim();

  const patch: Record<string, unknown> = {
    agent_url: String(agent.url || build.agent_url || ''),
    branch: git.branch || build.branch,
    pr_url: git.prUrl || build.pr_url,
  };

  if (agentStatus === 'ARCHIVED') {
    return saveBuild(build.conversation_id, {
      ...patch,
      status: 'failed',
      error: 'The agent for this conversation was archived. Send a new message to start again.',
      agent_id: '',
      run_id: '',
    });
  }

  const vercelOn = Boolean(env('VERCEL_TOKEN') && env('VERCEL_PROJECT_ID'));
  const progressInput = {
    previous: Number(build.progress_pct || 0),
    runStatus,
    toolCalls: Number(build.tool_calls || 0),
    branch: String(patch.branch || ''),
    prUrl: String(patch.pr_url || ''),
    deployState: '',
    finished: false,
  };

  if (!terminal(runStatus)) {
    // Fold a slice of the run stream into the note / tool count.
    const tap = await tapRunStream(build, runId);
    if (tap) {
      patch.progress_note = tap.note;
      patch.tool_calls = tap.toolCalls;
      patch.stream_cursor = tap.cursor;
      progressInput.toolCalls = tap.toolCalls;
    }
    // Still working: no preview yet. Anything Vercel has built so far is an
    // earlier commit (or the previous run), so showing it would open the app
    // without this change. Only the deployment state feeds the progress bar.
    if (progressInput.branch && vercelOn) {
      const deployment = await vercelDeployment(progressInput.branch, runWindow(build, run)).catch(() => null);
      if (deployment) progressInput.deployState = deployment.latestState;
    }
    patch.progress_pct = progressPercent(progressInput);
    return saveBuild(build.conversation_id, { ...patch, status: 'baking', preview_url: '', error: '' });
  }
  progressInput.finished = runStatus === 'FINISHED';

  // First time we see this run finished: tell the thread.
  if (build.replied_run_id !== runId) {
    if (runStatus === 'FINISHED') {
      await postReply(build, build.last_request_id, result);
      await finishRequests(build.conversation_id, build.run_started_at || String(run.createdAt || '') || null);
    }
    patch.replied_run_id = runId;
    if (runStatus === 'FINISHED' && result) patch.summary = result.slice(0, 4000);
  }

  if (build.pending_prompt) {
    const queued = await saveBuild(build.conversation_id, patch);
    try {
      return await followUp(queued, queued.pending_request_id, queued.pending_prompt);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not send the follow-up.';
      return saveBuild(build.conversation_id, { status: 'failed', error: message.slice(0, 1000) });
    }
  }

  if (runStatus !== 'FINISHED') {
    const fallback =
      runStatus === 'CANCELLED' ? 'The agent run was cancelled.' : 'The agent run failed.';
    return saveBuild(build.conversation_id, {
      ...patch,
      status: 'failed',
      error: (result || fallback).slice(0, 1000),
    });
  }

  const branch = progressInput.branch;
  if (!branch || !vercelOn) {
    return saveBuild(build.conversation_id, {
      ...patch,
      status: 'ready',
      error: '',
      progress_pct: 100,
      progress_note: branch ? 'Finished' : 'Replied in the chat',
    });
  }

  // The run is done, so the branch head is the agent's final push. Only a
  // deployment of that commit counts as "the preview"; an older READY
  // deployment on the same branch would open the app without this change.
  const deployment = await vercelDeployment(branch, await finalDeploymentMatch(build, run, branch));
  progressInput.deployState = deployment.latestState;
  if (deployment.readyUrl && deployment.latestState === 'READY') {
    return saveBuild(build.conversation_id, {
      ...patch,
      status: 'ready',
      preview_url: deployment.readyUrl,
      error: '',
      progress_pct: 100,
      progress_note: 'Preview ready',
    });
  }
  if (deployment.latestState === 'ERROR' || deployment.latestState === 'CANCELED') {
    return saveBuild(build.conversation_id, {
      ...patch,
      status: 'failed',
      preview_url: '',
      error: 'The preview deployment failed to build.',
    });
  }
  const finishedAt = new Date(String(run.updatedAt || build.updated_at || Date.now())).getTime();
  if (deployment.none && Date.now() - finishedAt > DEPLOY_WAIT_MS) {
    return saveBuild(build.conversation_id, {
      ...patch,
      status: 'ready',
      preview_url: '',
      error: '',
      progress_pct: 100,
      progress_note: 'Finished',
    });
  }
  // Vercel is still building the final commit (or has not picked it up yet).
  return saveBuild(build.conversation_id, {
    ...patch,
    status: 'baking',
    preview_url: '',
    error: '',
    progress_pct: progressPercent(progressInput),
    progress_note: 'Building the preview',
  });
}

/** Deployments created during this run; older ones belong to a previous message. */
function runWindow(build: BuildRow, run: Record<string, unknown>): VercelDeploymentMatch {
  const since = Date.parse(String(build.run_started_at || run.createdAt || ''));
  return Number.isFinite(since) && since > 0 ? { since } : {};
}

/**
 * How to recognise the finished run's deployment. Preferred: the commit the
 * branch points at now (GitHub). Without GitHub access, fall back to "created
 * after the run started", which can miss a run that pushed nothing new.
 */
async function finalDeploymentMatch(
  build: BuildRow,
  run: Record<string, unknown>,
  branch: string,
): Promise<VercelDeploymentMatch> {
  const repoUrl = env('CURSOR_REPO_URL', 'https://github.com/n0velti/mycanadagold');
  const sha = await githubBranchHeadSha(repoUrl, branch);
  if (sha) return { commitSha: sha };
  return runWindow(build, run);
}

function publicBuild(row: BuildRow | null): Record<string, unknown> | null {
  if (!row) return null;
  // pending_prompt is the staff member's own text, but there is no reason to echo it back.
  const { pending_prompt: _pending, ...rest } = row;
  return rest;
}

export async function handleAgentBuildStart(req: Request, staff: StaffContext): Promise<Response> {
  const body = await readJson<{ requestId?: string }>(req);
  const requestId = String(body.requestId || '').trim();
  if (!requestId || !UUID_RE.test(requestId)) return error(req, 400, 'Missing request.', 'bad_request');
  if (!env('CURSOR_API_KEY')) {
    return error(req, 503, 'The agent is not set up yet.', 'misconfigured');
  }

  let request: RequestRow | null;
  try {
    request = await loadRequest(requestId);
  } catch (err) {
    const message = err instanceof Error ? err.message : '';
    if (/schema cache|does not exist|agent_requests/i.test(message)) {
      return error(req, 503, 'Agent requests are not available yet.', 'misconfigured');
    }
    throw err;
  }
  if (!request) return error(req, 404, 'That request was not found.', 'not_found');
  if (request.sender_id !== staff.userId) return error(req, 403, 'Not your request.', 'forbidden');

  let build: BuildRow | null;
  try {
    build = await loadBuild(request.conversation_id);
  } catch (err) {
    const message = err instanceof Error ? err.message : '';
    if (isMissingTable(message)) return error(req, 503, 'Agent builds are not available yet.', 'misconfigured');
    throw err;
  }

  await setRequestStatus(request.id, 'in_progress');
  const name = await senderName(staff.userId);

  try {
    if (build?.agent_id) {
      try {
        const saved = await followUp(build, request.id, followUpPrompt(request.body, name, requestImages(request)));
        return json(req, 200, { build: publicBuild(saved) });
      } catch (err) {
        // Agent gone (archived / deleted): start a fresh one on a new branch.
        if (!(err instanceof CursorApiError) || err.status < 400 || err.status >= 500) throw err;
      }
    }
    const saved = await createAgent(build, request, firstPrompt(request.body, name, requestImages(request)));
    return json(req, 200, { build: publicBuild(saved) });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not start the agent.';
    console.error('agent build start', message);
    const failed = await saveBuild(request.conversation_id, {
      sender_id: request.sender_id,
      status: 'failed',
      error: message.slice(0, 1000),
      last_request_id: request.id,
    });
    return json(req, 200, { build: publicBuild(failed) });
  }
}

/**
 * The requester is happy with the preview. Marks the build and tells the
 * requester's own Agent thread. Do not DM other staff — publish notes go
 * to Gilmour via AGENT_WEBHOOK_URL (the app posts /agent/change-request).
 */
export async function handleAgentBuildPublish(req: Request, staff: StaffContext): Promise<Response> {
  const body = await readJson<{ conversationId?: string }>(req);
  const conversationId = String(body.conversationId || '').trim();
  if (!conversationId || !UUID_RE.test(conversationId)) {
    return error(req, 400, 'Missing conversation.', 'bad_request');
  }
  let build: BuildRow | null;
  try {
    build = await loadBuild(conversationId);
  } catch (err) {
    const message = err instanceof Error ? err.message : '';
    if (isMissingTable(message)) return error(req, 503, 'Agent builds are not available yet.', 'misconfigured');
    throw err;
  }
  if (!build) return error(req, 404, 'Nothing to publish yet.', 'not_found');
  if (build.sender_id !== staff.userId) return error(req, 403, 'Not your conversation.', 'forbidden');
  if (build.status !== 'ready') {
    return error(req, 409, 'Wait until the agent has finished before publishing.', 'not_ready');
  }
  if (!build.pr_url && !build.branch) {
    return error(req, 409, 'The agent did not push any changes to publish.', 'nothing_to_publish');
  }
  if (build.publish_state === 'requested' && build.published_run_id === build.run_id) {
    return json(req, 200, { build: publicBuild(build), unchanged: true });
  }

  const saved = await saveBuild(conversationId, {
    publish_state: 'requested',
    published_at: new Date().toISOString(),
    published_run_id: build.run_id,
  });
  await postThreadEvent(
    saved,
    saved.last_request_id,
    'Sent for publishing.',
    'status',
    staff.userId,
  );
  return json(req, 200, { build: publicBuild(saved), unchanged: false });
}

export async function handleAgentBuildRefresh(req: Request, staff: StaffContext): Promise<Response> {
  const body = await readJson<{ conversationId?: string }>(req);
  const conversationId = String(body.conversationId || '').trim();
  if (!conversationId || !UUID_RE.test(conversationId)) {
    return error(req, 400, 'Missing conversation.', 'bad_request');
  }
  let build: BuildRow | null;
  try {
    build = await loadBuild(conversationId);
  } catch (err) {
    const message = err instanceof Error ? err.message : '';
    if (isMissingTable(message)) return error(req, 503, 'Agent builds are not available yet.', 'misconfigured');
    throw err;
  }
  if (!build) return json(req, 200, { build: null });
  if (build.sender_id !== staff.userId && !staff.isSystemAdmin) {
    return error(req, 403, 'Not your conversation.', 'forbidden');
  }
  if (build.status !== 'baking' || !build.agent_id) {
    return json(req, 200, { build: publicBuild(build) });
  }
  try {
    const synced = await syncBuild(build);
    return json(req, 200, { build: publicBuild(synced) });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not refresh the build.';
    console.error('agent build refresh', message);
    // Transient Cursor / Vercel errors should not flip a working build to failed.
    return json(req, 200, { build: publicBuild(build), warning: message.slice(0, 300) });
  }
}
