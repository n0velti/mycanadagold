/**
 * Expo web export puts vector-icon fonts under
 * dist/assets/node_modules/..., which Vercel (and other hosts) strip from the
 * deployment. Rename that folder and rewrite bundle URLs so Sohne and app
 * icons actually load in production.
 */
const fs = require('fs');
const path = require('path');

const DIST = path.join(__dirname, '..', 'dist');
const FROM = path.join(DIST, 'assets', 'node_modules');
const TO = path.join(DIST, 'assets', 'vendor');

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function main() {
  if (!fs.existsSync(DIST)) {
    console.error('dist/ not found. Run `expo export --platform web` first.');
    process.exit(1);
  }

  if (fs.existsSync(FROM)) {
    if (fs.existsSync(TO)) fs.rmSync(TO, { recursive: true, force: true });
    fs.renameSync(FROM, TO);
    console.log('Moved dist/assets/node_modules → dist/assets/vendor');
  }

  let rewritten = 0;
  for (const file of walk(DIST)) {
    if (!/\.(js|html|css|json|map)$/.test(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    if (!text.includes('assets/node_modules')) continue;
    fs.writeFileSync(file, text.replaceAll('assets/node_modules', 'assets/vendor'));
    rewritten += 1;
  }
  console.log(`Rewrote ${rewritten} file(s) to use /assets/vendor/ font paths.`);
}

main();
