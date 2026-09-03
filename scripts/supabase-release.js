/**
 * One-shot release of the Supabase side using only a personal access token
 * (Dashboard → Account → Access Tokens; needs database, auth, secrets and
 * edge-function write scopes). No Supabase CLI required.
 *
 *   SUPABASE_ACCESS_TOKEN=sbp_… npm run supabase:release
 *
 * Steps (each can be skipped with --skip-<step>):
 *   migrate   apply pending supabase/migrations (delegates to apply-migrations.js)
 *   auth      disable signups + confirmation emails, raise OTP verify rate limit
 *   secrets   push supabase/.env.local as Edge Function secrets
 *   functions deploy aureus-login (verify_jwt off) and proxy
 *
 * The Supabase CLI equivalents remain: `supabase db push`, `supabase config push`,
 * `supabase secrets set --env-file supabase/.env.local`, `supabase functions deploy`.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PROJECT_REF = String(process.env.SUPABASE_PROJECT_REF || 'bkvyyddtevzvuanzkobd').trim();
const API = `https://api.supabase.com/v1/projects/${PROJECT_REF}`;
const FUNCTIONS = [
  { slug: 'aureus-login', verifyJwt: false },
  { slug: 'proxy', verifyJwt: false },
];
const AUTH_CONFIG = {
  disable_signup: true, // accounts are created only by aureus-login
  mailer_autoconfirm: true, // never send a confirmation email
  external_anonymous_users_enabled: false,
  rate_limit_verify: 600, // every sign-in is one OTP verify from the function's egress IP
  password_min_length: 12,
};

const skip = new Set(process.argv.filter((arg) => arg.startsWith('--skip-')).map((arg) => arg.slice(7)));

function loadLocalEnv(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
    out[key] = value;
  }
  return out;
}

function token() {
  const fromRootEnv = loadLocalEnv(path.join(ROOT, '.env.local')).SUPABASE_ACCESS_TOKEN;
  const value = String(process.env.SUPABASE_ACCESS_TOKEN || fromRootEnv || '').trim();
  if (!value) {
    console.error('SUPABASE_ACCESS_TOKEN is required (personal access token, sbp_…).');
    process.exit(1);
  }
  return value;
}

async function api(accessToken, method, route, body, isForm = false) {
  const headers = { Authorization: `Bearer ${accessToken}` };
  if (body && !isForm) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${API}${route}`, {
    method,
    headers,
    body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${route} → HTTP ${response.status}: ${text.slice(0, 600)}`);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function step(name, fn) {
  if (skip.has(name)) {
    console.log(`[${name}] skipped`);
    return Promise.resolve();
  }
  console.log(`[${name}] …`);
  return fn();
}

async function migrate(accessToken) {
  execFileSync(process.execPath, [path.join(__dirname, 'apply-migrations.js')], {
    stdio: 'inherit',
    env: { ...process.env, SUPABASE_ACCESS_TOKEN: accessToken, SUPABASE_PROJECT_REF: PROJECT_REF },
  });
}

async function configureAuth(accessToken) {
  await api(accessToken, 'PATCH', '/config/auth', AUTH_CONFIG);
  const current = await api(accessToken, 'GET', '/config/auth');
  const ok = current.disable_signup === true && current.mailer_autoconfirm === true;
  if (!ok) throw new Error('Auth config did not apply; check the token scopes.');
  console.log('[auth] signups disabled, confirmation emails off, verify rate limit', current.rate_limit_verify);
}

async function pushSecrets(accessToken) {
  const file = path.join(ROOT, 'supabase', '.env.local');
  const env = loadLocalEnv(file);
  const entries = Object.entries(env).filter(([name, value]) => value && !name.startsWith('SUPABASE_'));
  if (entries.length === 0) {
    console.log('[secrets] nothing to push (create supabase/.env.local from supabase/.env.example)');
    return;
  }
  await api(
    accessToken,
    'POST',
    '/secrets',
    entries.map(([name, value]) => ({ name, value })),
  );
  console.log(`[secrets] pushed ${entries.map(([name]) => name).join(', ')}`);
}

function collectFunctionFiles(slug) {
  const dirs = [path.join('supabase', 'functions', slug), path.join('supabase', 'functions', '_shared')];
  const files = [];
  for (const dir of dirs) {
    for (const entry of fs.readdirSync(path.join(ROOT, dir))) {
      if (/\.(ts|js|json)$/.test(entry)) files.push(path.join(dir, entry).split(path.sep).join('/'));
    }
  }
  return files;
}

async function deployFunctions(accessToken) {
  for (const { slug, verifyJwt } of FUNCTIONS) {
    const form = new FormData();
    const entrypoint = `supabase/functions/${slug}/index.ts`;
    form.append(
      'metadata',
      JSON.stringify({ name: slug, entrypoint_path: entrypoint, verify_jwt: verifyJwt }),
    );
    for (const relative of collectFunctionFiles(slug)) {
      const bytes = fs.readFileSync(path.join(ROOT, relative));
      form.append('file', new Blob([bytes], { type: 'text/plain' }), relative);
    }
    const result = await api(accessToken, 'POST', `/functions/deploy?slug=${slug}`, form, true);
    console.log(`[functions] ${slug} v${result.version} ${result.status} (verify_jwt=${result.verify_jwt})`);
  }
}

async function main() {
  const accessToken = token();
  await step('migrate', () => migrate(accessToken));
  await step('auth', () => configureAuth(accessToken));
  await step('secrets', () => pushSecrets(accessToken));
  await step('functions', () => deployFunctions(accessToken));
  console.log('Supabase release complete for project', PROJECT_REF);
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
