/**
 * Release guard: scans the exported web bundle (dist/) for anything that must
 * never ship to a browser. Run after `npm run build:web`.
 *
 *   npm run build:web && npm run check:secrets
 */
const fs = require('fs');
const path = require('path');

const DIST = path.join(__dirname, '..', 'dist');

const PATTERNS = [
  { label: 'Supabase secret key', regex: /sb_secret_[A-Za-z0-9_-]{10,}/ },
  { label: 'OpenRouter key', regex: /sk-or-v1-[A-Za-z0-9]{20,}/ },
  { label: 'Anthropic key', regex: /sk-ant-[A-Za-z0-9_-]{20,}/ },
  { label: 'OpenAI key', regex: /\bsk-(?:proj-)?[A-Za-z0-9]{32,}\b/ },
  { label: 'Supabase access token', regex: /sbp_[a-f0-9]{30,}/ },
  { label: 'service_role JWT', regex: /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]*c2VydmljZV9yb2xl[A-Za-z0-9_-]*\./ },
  { label: 'shared POS password', regex: /Gold1234/ },
  { label: 'Rippling client secret env', regex: /RIPPLING_CLIENT_SECRET/ },
  { label: 'localhost proxy fallback', regex: /localhost:8787/ },
];

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(js|html|json|map|css)$/.test(entry.name)) out.push(full);
  }
  return out;
}

function main() {
  if (!fs.existsSync(DIST)) {
    console.error('dist/ not found. Run `npm run build:web` first.');
    process.exit(1);
  }

  const findings = [];
  for (const file of walk(DIST)) {
    const text = fs.readFileSync(file, 'utf8');
    for (const { label, regex } of PATTERNS) {
      const match = text.match(regex);
      if (match) {
        findings.push({ file: path.relative(DIST, file), label, sample: match[0].slice(0, 12) + '…' });
      }
    }
  }

  if (findings.length) {
    console.error('Refusing to ship: sensitive material found in the web bundle.');
    for (const finding of findings) {
      console.error(`  ${finding.label} in ${finding.file} (${finding.sample})`);
    }
    process.exit(1);
  }
  console.log('Bundle check passed: no secrets or dev proxy fallbacks in dist/.');
}

main();
