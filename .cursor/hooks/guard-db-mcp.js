#!/usr/bin/env node
/**
 * Cursor beforeMCPExecution hook for the Supabase MCP server.
 *
 * `execute_sql` and `apply_migration` run as postgres on the hosted project,
 * outside RLS. This hook refuses DELETE / TRUNCATE / DROP and branch or
 * project destruction, asks before any other write or deploy, and lets
 * read-only tools (list_tables, get_logs, get_advisors, search_docs, SELECT)
 * through. Servers other than Supabase are not touched.
 *
 * Calls that name the dev project (`project_id`) are relaxed: writes and
 * deploys allowed, destruction asks. Production, or a call with no project
 * id (a project-scoped server could be either), stays strict.
 *
 * Pairs with the in-database guards (supabase/migrations/*_delete_guardrails.sql)
 * and .cursor/hooks/guard-db-shell.js.
 */
const DEV_REF = 'mrvyckltclmcwshnnqfu';

const chunks = [];
process.stdin.on('data', (chunk) => chunks.push(chunk));
process.stdin.on('end', () => {
  let input = {};
  try {
    input = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    input = {};
  }
  process.stdout.write(`${JSON.stringify(decide(input))}\n`);
});

const DESTRUCTIVE_SQL = /\b(delete|truncate|drop)\b/i;
const WRITE_SQL = /\b(update|insert|upsert|alter|create|grant|revoke|reindex|vacuum|set)\b/i;
const OVERRIDE_GUC = /allow_destructive/i;

const DENY_TOOLS = new Set(['delete_branch', 'reset_branch']);
const ASK_TOOLS = new Set([
  'apply_migration',
  'deploy_edge_function',
  'create_branch',
  'merge_branch',
  'rebase_branch',
  'create_project',
  'pause_project',
  'restore_project',
  'confirm_cost',
]);

function isSupabase(input) {
  const name = String(input.mcp_server_name || '').toLowerCase();
  const url = String(input.mcp_server_url || input.url || '').toLowerCase();
  const command = String(input.command || '').toLowerCase();
  return name.includes('supabase') || url.includes('supabase.com') || command.includes('supabase');
}

function paramsOf(input) {
  let params = input.tool_input;
  if (typeof params === 'string') {
    try {
      params = JSON.parse(params);
    } catch {
      return { raw: params };
    }
  }
  return params && typeof params === 'object' ? params : {};
}

function sqlFrom(params) {
  return [params.raw, params.query, params.sql, params.statement].filter((v) => typeof v === 'string').join('\n');
}

function targetsDev(params) {
  const id = String(params.project_id || params.projectId || params.project_ref || params.ref || '').trim().toLowerCase();
  return id === DEV_REF;
}

function deny(userMessage, agentMessage) {
  return { permission: 'deny', user_message: userMessage, agent_message: agentMessage };
}

function ask(userMessage, agentMessage) {
  return { permission: 'ask', user_message: userMessage, agent_message: agentMessage };
}

function decide(input) {
  if (!isSupabase(input)) return { permission: 'allow' };
  const tool = String(input.tool_name || '').toLowerCase();
  const params = paramsOf(input);
  const isDev = targetsDev(params);

  if (DENY_TOOLS.has(tool)) {
    if (isDev) {
      return ask(`Supabase MCP \`${tool}\` on the DEV project. Approve only if intended.`, 'This targets the dev project. The user must confirm.');
    }
    return deny(
      `Blocked: Supabase MCP \`${tool}\` destroys a database branch.`,
      'Deleting or resetting a Supabase branch is never allowed from an agent.',
    );
  }

  if (tool === 'execute_sql' || tool === 'apply_migration') {
    const sql = sqlFrom(params);
    if (isDev) {
      if (DESTRUCTIVE_SQL.test(sql) || OVERRIDE_GUC.test(sql)) {
        return ask(
          'Destructive SQL against the DEV database. Approve only if intended.',
          'This targets the dev project. Production is never allowed; dev needs the user to confirm.',
        );
      }
      return { permission: 'allow' };
    }
    if (OVERRIDE_GUC.test(sql)) {
      return deny(
        'Blocked: an agent may not set cgold.allow_destructive.',
        'The cgold.allow_destructive override is for a human in the SQL editor. Do not set it from MCP.',
      );
    }
    if (DESTRUCTIVE_SQL.test(sql)) {
      return deny(
        'Blocked: DELETE / TRUNCATE / DROP through the Supabase MCP.',
        'Row deletion and drops are only done by app features (RLS) or by a person in the Supabase SQL editor. If the word appears only in a comment, rephrase the query. Schema changes go in a migration file under supabase/migrations for the user to apply.',
      );
    }
    if (tool === 'apply_migration') {
      return ask(
        'apply_migration changes the live schema. Approve only if intended.',
        'Prefer writing the migration to supabase/migrations and letting the user apply it with `npm run supabase:release`.',
      );
    }
    if (WRITE_SQL.test(sql)) {
      return ask(
        'This SQL writes to the live database. Approve only if intended.',
        'Direct writes to the hosted database need the user to approve. Read-only SELECTs are fine.',
      );
    }
    return { permission: 'allow' };
  }

  if (ASK_TOOLS.has(tool)) {
    if (isDev) return { permission: 'allow' };
    return ask(
      `Supabase MCP \`${tool}\` changes the hosted project.`,
      'This Supabase MCP tool deploys or changes project resources and needs explicit approval from the user.',
    );
  }

  return { permission: 'allow' };
}
