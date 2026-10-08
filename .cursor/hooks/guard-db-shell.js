#!/usr/bin/env node
/**
 * Cursor beforeShellExecution hook.
 *
 * The Supabase CLI on a developer machine is logged in and linked to the live
 * project, so an agent's shell command can reach production Postgres as
 * `postgres`. This hook refuses destructive database commands outright and
 * asks before anything that writes to or deploys the hosted project.
 * Read-only queries and everything unrelated to the database pass through.
 *
 * Two hosted projects exist. Commands aimed at the dev project are relaxed
 * (deploys and writes allowed, destruction asks); production and anything
 * whose target cannot be determined stay strict.
 *
 * Pairs with the in-database guards (supabase/migrations/*_delete_guardrails.sql)
 * and .cursor/hooks/guard-db-mcp.js. Runs in Cursor and in cloud agents.
 */
const fs = require('fs');
const path = require('path');

const PROD_REF = 'bkvyyddtevzvuanzkobd';
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
  const command = String(input.command || '').replace(/\s+/g, ' ').trim();
  process.stdout.write(`${JSON.stringify(decide(command, String(input.cwd || process.cwd())))}\n`);
});

const DESTRUCTIVE_SQL = /\b(delete|truncate|drop)\b/i;
const WRITE_SQL = /\b(update|insert|upsert|alter|create|grant|revoke|reindex|vacuum)\b/i;
const OVERRIDE_GUC = /allow_destructive/i;

function linkedRef(cwd) {
  let dir = cwd;
  for (let i = 0; i < 6; i += 1) {
    try {
      return fs.readFileSync(path.join(dir, 'supabase', '.temp', 'project-ref'), 'utf8').trim();
    } catch {
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return '';
}

/** Which hosted project a command is aimed at: a ref, or '' when unknown. */
function targetRef(command, cwd) {
  const explicit =
    command.match(/--project-ref[= ]([a-z]{20})\b/i) ||
    command.match(/\bSUPABASE_PROJECT_REF=([a-z]{20})\b/) ||
    command.match(/api\.supabase\.com\/v1\/projects\/([a-z]{20})\b/i) ||
    command.match(/\b(?:db\.|postgres\.)?([a-z]{20})\.(?:supabase\.co|pooler\.supabase\.com)/i) ||
    command.match(/\bpostgres\.([a-z]{20})[:@]/i);
  if (explicit) return explicit[1].toLowerCase();
  if (/scripts\/(apply-migrations|supabase-release)\.js|\bsupabase:(release|migrate|deploy:token)\b/i.test(command)) {
    return /--prod\b|:prod\b/.test(command) ? PROD_REF : DEV_REF;
  }
  if (/\bsupabase\b/i.test(command)) return linkedRef(cwd);
  return '';
}

/** Commands that run SQL against the hosted database as postgres. */
function runsRemoteSql(command) {
  if (/\bsupabase\b[^|;&]*\bdb\s+query\b/i.test(command) && !/\s--local\b/i.test(command)) return true;
  if (/\bpsql\b/i.test(command)) return true;
  if (/api\.supabase\.com\/v1\/projects\/[^/\s]+\/database\/query/i.test(command)) return true;
  if (/\bpg_dump\b|\bpg_restore\b/i.test(command)) return true;
  return false;
}

/** Commands that change the hosted project (schema, functions, secrets, config). */
function deploysToProject(command) {
  return (
    /\bsupabase\b[^|;&]*\bdb\s+push\b/i.test(command) ||
    /\bsupabase\b[^|;&]*\bmigration\s+(up|repair|squash)\b/i.test(command) ||
    /\bsupabase\b[^|;&]*\bfunctions\s+(deploy|delete)\b/i.test(command) ||
    /\bsupabase\b[^|;&]*\bsecrets\s+(set|unset)\b/i.test(command) ||
    /\bsupabase\b[^|;&]*\bconfig\s+push\b/i.test(command) ||
    /\bnpm\s+run\s+supabase:(release|migrate|push|deploy|deploy:token|secrets)\b/i.test(command) ||
    /scripts\/(apply-migrations|supabase-release)\.js/i.test(command)
  );
}

function deny(userMessage, agentMessage) {
  return { permission: 'deny', user_message: userMessage, agent_message: agentMessage };
}

function ask(userMessage, agentMessage) {
  return { permission: 'ask', user_message: userMessage, agent_message: agentMessage };
}

function decide(command, cwd) {
  if (!command) return { permission: 'allow' };

  const target = targetRef(command, cwd);
  const isDev = target === DEV_REF;

  // Whole-database destruction against the hosted project.
  if (/\bsupabase\b[^|;&]*\bdb\s+reset\b/i.test(command) && /--(linked|project-ref|db-url)\b/i.test(command)) {
    if (isDev) {
      return ask(
        'Reset the DEV database? All dev data will be lost.',
        'This resets the dev project, not production. The user must confirm.',
      );
    }
    return deny(
      'Blocked: `supabase db reset` against the hosted project would wipe production.',
      'This command resets the hosted Supabase database. It is never allowed from an agent. Local resets (`supabase db reset` with no --linked/--project-ref/--db-url) are fine.',
    );
  }
  if (/\bsupabase\b[^|;&]*\bprojects\s+delete\b/i.test(command)) {
    return deny('Blocked: deleting a Supabase project.', 'Deleting a Supabase project is never allowed from an agent.');
  }
  if (/\bsupabase\b[^|;&]*\bbranches\s+(delete|reset)\b/i.test(command)) {
    return deny('Blocked: destructive Supabase branch command.', 'Deleting or resetting a Supabase branch is never allowed from an agent.');
  }

  if (runsRemoteSql(command)) {
    if (isDev) {
      if (DESTRUCTIVE_SQL.test(command) || OVERRIDE_GUC.test(command)) {
        return ask(
          'Destructive SQL against the DEV database. Approve only if intended.',
          'This targets the dev project. Production is never allowed; dev needs the user to confirm.',
        );
      }
      return { permission: 'allow' };
    }
    if (OVERRIDE_GUC.test(command)) {
      return deny(
        'Blocked: an agent may not set cgold.allow_destructive.',
        'The cgold.allow_destructive override is for a human in the SQL editor. Do not set it from a script or command.',
      );
    }
    if (DESTRUCTIVE_SQL.test(command)) {
      return deny(
        'Blocked: DELETE / TRUNCATE / DROP against the live database.',
        'Row deletion and drops are only done by app features (RLS) or by a person in the Supabase SQL editor. Write a migration for schema changes and ask the user to apply it; never delete data from a command.',
      );
    }
    if (/(\s-f\s|--file\b)/i.test(command)) {
      return ask(
        'This runs a SQL file against the live database. Review it first.',
        'The SQL comes from a file, so the guard cannot inspect it. Make sure it contains no DELETE, TRUNCATE, or DROP. The user must approve.',
      );
    }
    if (WRITE_SQL.test(command)) {
      return ask(
        'This SQL writes to the live database. Approve only if intended.',
        'Direct writes to the hosted database need the user to approve. Prefer a migration under supabase/migrations applied with `npm run supabase:release`.',
      );
    }
    return { permission: 'allow' };
  }

  if (deploysToProject(command)) {
    if (isDev) return { permission: 'allow' };
    return ask(
      'This changes the PRODUCTION Supabase project (migrations, functions, secrets, or config).',
      'Releasing to the production Supabase project needs explicit approval from the user. Do not retry without it. Dev releases (`npm run supabase:release`, or the CLI linked to the dev project) are allowed.',
    );
  }

  return { permission: 'allow' };
}
