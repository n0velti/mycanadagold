/**
 * The two hosted Supabase projects. Scripts default to dev; production is
 * opt-in with `--prod` (or an explicit SUPABASE_PROJECT_REF).
 *
 *   npm run supabase:release          → dev
 *   npm run supabase:release:prod     → production
 */
const PROD_REF = 'bkvyyddtevzvuanzkobd';
const DEV_REF = 'mrvyckltclmcwshnnqfu';

function resolveProjectRef(argv = process.argv, env = process.env) {
  const explicit = String(env.SUPABASE_PROJECT_REF || '').trim();
  if (explicit) return explicit;
  return argv.includes('--prod') ? PROD_REF : DEV_REF;
}

function describeProject(ref) {
  if (ref === PROD_REF) return `PRODUCTION (${ref})`;
  if (ref === DEV_REF) return `dev (${ref})`;
  return `custom project (${ref})`;
}

module.exports = { PROD_REF, DEV_REF, resolveProjectRef, describeProject };
