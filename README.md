# MyCanadaGold

Staff tools for Canada Gold (Expo SDK 54 · React Native · Supabase). Runs on the web, iOS and Android from one codebase.

## Access model

Only people with an **active Aureus POS account** can get in. There is no self-signup, no email confirmation, and no password stored by this app.

```
LoginScreen ──► Edge Function `aureus-login` ──► Aureus POS /login
                        │  (service role)
                        ├─ find/create auth user (email pre-confirmed → no mail ever sent)
                        ├─ upsert public.profiles (aureus_verified_at, is_active)
                        ├─ refuse if is_active = false
                        └─ mint Supabase session (one-time token hash, never emailed)
```

Everything after sign-in is enforced twice:

- **Database (RLS)** — every policy requires `is_active_staff()`: a JWT minted by `aureus-login` (`app_metadata.aureus_user_id`, writable only by the service role) whose Aureus identity matches an active, verified profile. `app_metadata.provider` is not used — GoTrue resets it to `email` when the OTP session is minted. Deactivating a profile revokes that user's sessions immediately (trigger).
- **Edge Function `proxy`** — the only path to third-party APIs (Anthropic, OpenAI, OpenRouter, FINTRAC, Rippling, Google reviews). It re-verifies the JWT and the profile on every call. Vendor keys and the Rippling OAuth client secret exist only as function secrets; the browser bundle contains none of them (`npm run check:secrets` enforces this).

Client secrets that must exist on the device (FINTRAC portal token, Rippling token, optional personal AI keys) are stored with `expo-secure-store` on native. On web they live in `localStorage`, scoped to the app origin and protected by the CSP in `public/index.html`.

## Repository layout

| Path | Purpose |
| --- | --- |
| `App.js` | Shell: session bootstrap, navigation, tool grid |
| `lib/` | Client modules. `auth.js` (session), `proxy.js` (gateway client), `supabase.js`, vendor clients |
| `components/` | Screens |
| `supabase/migrations/` | Schema, RLS, triggers, login throttling |
| `supabase/functions/aureus-login` | Sign-in gateway (verify_jwt off; validates everything itself) |
| `supabase/functions/proxy` | Authenticated third-party gateway |
| `supabase/functions/_shared` | Aureus client, identity mapping, JWT/staff checks, HTTP helpers |
| `scripts/` | `apply-migrations.js`, `check-bundle-secrets.js` |
| `public/` | Web `index.html` (CSP) and `_headers` (security headers for static hosts) |

## Two Supabase projects

| | Project | Used by |
| --- | --- | --- |
| **Production** | `bkvyyddtevzvuanzkobd` (`mycanadagold`) | `main` → `https://www.mycanadagold.ca`. Values come from the committed `.env.production`. |
| **Dev** | `mrvyckltclmcwshnnqfu` (`mycanadagold-dev`) | Local `npm run web` (`.env.local`), the `dev` branch, Vercel previews, cloud-agent previews. |

Same schema (both get every file in `supabase/migrations/`), same Edge Functions and secrets, separate data and separate staff accounts. Dev starts empty; the first person to sign in there becomes `system_admin`. Scripts and the CLI default to **dev**; production is always an explicit `:prod` / `--prod`.

Vercel previews only use dev once these are set for the **Preview** environment (Vercel → Project → Settings → Environment Variables; leave Production unset so it keeps `.env.production`):

```
EXPO_PUBLIC_SUPABASE_URL=https://mrvyckltclmcwshnnqfu.supabase.co
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_1OQ2FYvsAD5GG8K1vxdu1Q_Ltp6DZCa
```

`npm run check:secrets` (part of the Vercel build) refuses a production deploy whose bundle references the dev project and a build whose inlined URL does not match `EXPO_PUBLIC_SUPABASE_URL`. `build:web` clears Metro's cache so a cached bundle from the other environment is never reused.

## Local development

```sh
npm install
cp .env.example .env.local          # points at the dev project
npm run web                         # or: npm run ios / npm run android
```

`.env.local` may only contain `EXPO_PUBLIC_*` values that are safe to publish. Never put a secret, service-role key, or vendor API key in it, and do not point it at production.

## Supabase setup (one time, and on every change)

Fastest path — one command with a personal access token (Dashboard → Account → Access Tokens):

```sh
cp supabase/.env.example supabase/.env.local     # fill in vendor keys / Rippling app / linked POS logins
SUPABASE_ACCESS_TOKEN=sbp_… npm run supabase:release        # dev
SUPABASE_ACCESS_TOKEN=sbp_… npm run supabase:release:prod   # production
```

This applies pending migrations, turns off signups and confirmation emails, raises the OTP verify rate limit, pushes the function secrets, and deploys the Edge Functions. Until it has run, the hosted project still allows signups and sends confirmation mail, and sign-in fails with "Could not reach the sign-in service."

The same steps individually (or with the Supabase CLI, which is linked to **dev**; add `--project-ref bkvyyddtevzvuanzkobd` for production):

1. **Database**

   ```sh
   npm run supabase:push            # CLI, linked project (dev)
   # or, without the CLI:
   SUPABASE_ACCESS_TOKEN=sbp_… npm run supabase:migrate         # dev
   SUPABASE_ACCESS_TOKEN=sbp_… npm run supabase:migrate:prod    # production
   ```

2. **Auth settings** — `supabase/config.toml` disables signups and email confirmations and raises the OTP verification rate limit. Push it with `supabase config push`, or mirror in the dashboard: Authentication → Sign In / Providers → *Allow new users to sign up* **off**, *Confirm email* **off**; Authentication → Rate Limits → *Token verifications* ≥ 600 / 5 min.

3. **Function secrets**

   ```sh
   cp supabase/.env.example supabase/.env.local   # fill in values
   npm run supabase:secrets
   ```

4. **Deploy functions**

   ```sh
   npm run supabase:deploy
   ```

   That uses `npx supabase` (no global CLI install). If deploy returns 403, the CLI is signed into a different org — log in with the Canada Gold account (`npx supabase login`, then `npx supabase link --project-ref mrvyckltclmcwshnnqfu`) or deploy with a personal access token:

   ```sh
   SUPABASE_ACCESS_TOKEN=sbp_… npm run supabase:deploy:token        # dev
   SUPABASE_ACCESS_TOKEN=sbp_… npm run supabase:deploy:token:prod   # production
   ```

The first profile ever created becomes `system_admin`; admins manage roles and can disable staff from Settings → Permissions.

## Web release

```sh
npm run lint
npm run build:web        # → dist/
npm run check:secrets    # refuses to ship if a key or dev fallback leaked into the bundle
```

Deploy `dist/` to any static host over HTTPS. `public/_headers` is picked up by Cloudflare Pages / Netlify; Vercel uses `vercel.json`. On other hosts set the same headers (`X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, HSTS, `Permissions-Policy`). Add the production origin to `CGOLD_ALLOWED_ORIGINS` and, for Rippling sign-in, register `https://<your-host>/` as the OAuth redirect URI.

### Vercel

Connect the Git repo. `vercel.json` exports the web app into `dist/` and serves it as a single-page app. Client modules live in `lib/` (not `api/`) so Vercel does not compile them as serverless functions.

## Operations

- **Disable someone**: Settings → Permissions → toggle *Access*. Their sessions are revoked and the next sign-in is refused, even if their Aureus login still works.
- **Someone left Aureus**: their next sign-in fails at the POS step; nothing else to do. Optionally disable the profile so their existing session ends right away.
- **Rotate a vendor key**: update the secret and redeploy (`npm run supabase:secrets && npm run supabase:deploy`). No app release needed.
- **Login abuse**: `aureus-login` throttles per login (8 failures / 15 min) and per IP (40 / 15 min); attempts are hashed in `public.login_attempts` and pruned after two days.

## Delete guardrails

Migration `20261008144120_delete_guardrails.sql` protects every table in `public`, on both projects:

- **App deletes are archived.** Every deleted row (from the app or from SQL) is copied to `cgold_audit.deleted_rows` with who did it. Exceptions: tables rebuilt on each import (`rippling_*` snapshots, `login_attempts`, `dm_presence`). Archive is purged after 180 days by `select cgold_audit.purge_deleted_rows();` (run it from the SQL editor occasionally, or schedule it if pg_cron is enabled).
- **Direct SQL cannot delete.** `DELETE` from the SQL editor, CLI, Management API or MCP (anything that is not app traffic through PostgREST) is refused. `TRUNCATE`, `DROP TABLE`, `DROP COLUMN` and `DROP SCHEMA public` are refused for everyone. `DROP POLICY/TRIGGER/FUNCTION/CONSTRAINT` stay allowed. App traffic is unchanged: RLS policies and `safeupdate` (no `DELETE` without `WHERE`) govern it as before.
- **Doing it on purpose** — one transaction, in the SQL editor, as a person:

  ```sql
  begin;
  set local cgold.allow_destructive = 'on';
  delete from public.some_table where id = '…';
  commit;
  ```

  A migration that must remove data or drop a column starts with the same `set local` line. Nothing else disables the guards; agents are told never to set it (`.cursor/rules/database-safety.mdc`, `.cursor/hooks/`).
- **Undo a delete**: find the row, then restore it by archive id.

  ```sql
  select id, deleted_at, table_name, session_role, auth_uid, row_data
  from cgold_audit.deleted_rows
  where table_name = 'triage_batches' and restored_at is null
  order by deleted_at desc limit 50;

  select cgold_audit.restore_deleted_row(123);
  ```

- **Backups**: daily physical backups (7 days) are on; point-in-time recovery is not. Turn PITR on in Dashboard → Database → Backups if a day of data loss is unacceptable.
- **Agent tooling**: `.cursor/hooks.json` denies destructive database commands and Supabase MCP calls aimed at production (or at an unknown target) and asks before anything that writes to or deploys it. Commands aimed at the dev project are allowed, except destruction, which asks. Hooks run in Cursor and in cloud agents.
