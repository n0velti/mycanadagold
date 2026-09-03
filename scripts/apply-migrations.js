/**
 * Applies every file in supabase/migrations to the hosted project, in order,
 * skipping versions already recorded in supabase_migrations.schema_migrations
 * (the same ledger the Supabase CLI uses, so `supabase db push` stays in sync).
 *
 *   SUPABASE_ACCESS_TOKEN=sbp_... npm run supabase:migrate
 *
 * Requires a personal access token (Dashboard → Account → Access Tokens).
 * Never pass the secret / service_role key here.
 */
const fs = require('fs');
const path = require('path');

const PROJECT_REF = String(process.env.SUPABASE_PROJECT_REF || 'bkvyyddtevzvuanzkobd').trim();
const MIGRATIONS_DIR = path.join(__dirname, '..', 'supabase', 'migrations');
const DASHBOARD_SQL = `https://supabase.com/dashboard/project/${PROJECT_REF}/sql/new`;

function loadLocalEnv() {
  const envPath = path.join(__dirname, '..', '.env.local');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
    if (process.env[key] == null) process.env[key] = value;
  }
}

async function runSql(token, query) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${text.slice(0, 800)}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function listMigrations() {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((file) => /^\d{14}_.+\.sql$/.test(file))
    .sort()
    .map((file) => ({
      file,
      version: file.slice(0, 14),
      name: file.slice(15).replace(/\.sql$/, ''),
      sql: fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8'),
    }));
}

async function main() {
  loadLocalEnv();
  const token = String(process.env.SUPABASE_ACCESS_TOKEN || '').trim();
  if (!token) {
    console.error(
      [
        'No SUPABASE_ACCESS_TOKEN in the environment.',
        'Create one under Dashboard → Account → Access Tokens, or paste the migrations by hand at:',
        DASHBOARD_SQL,
      ].join('\n'),
    );
    process.exit(1);
  }

  await runSql(
    token,
    `create schema if not exists supabase_migrations;
     create table if not exists supabase_migrations.schema_migrations (
       version text primary key,
       statements text[],
       name text
     );`,
  );

  const applied = new Set(
    (await runSql(token, 'select version from supabase_migrations.schema_migrations;'))
      .map((row) => String(row.version)),
  );

  const pending = listMigrations().filter((migration) => !applied.has(migration.version));
  if (pending.length === 0) {
    console.log('Database is up to date.');
    return;
  }

  for (const migration of pending) {
    process.stdout.write(`Applying ${migration.file} … `);
    const ledger = `insert into supabase_migrations.schema_migrations (version, name)
      values ('${migration.version}', '${migration.name.replace(/'/g, "''")}')
      on conflict (version) do nothing;`;
    await runSql(token, `begin;\n${migration.sql}\n${ledger}\ncommit;`);
    console.log('done');
  }
  console.log(`Applied ${pending.length} migration(s) to project ${PROJECT_REF}.`);
}

main().catch((error) => {
  console.error(error?.message || error);
  console.error(`If this keeps failing, apply the remaining files manually: ${DASHBOARD_SQL}`);
  process.exit(1);
});
