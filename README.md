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

- **Database (RLS)** — every policy requires `is_active_staff()`: a JWT minted by `aureus-login` (`app_metadata.provider = 'aureus'`) whose Aureus identity matches an active, verified profile. Deactivating a profile revokes that user's sessions immediately (trigger).
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

## Local development

```sh
npm install
cp .env.example .env.local          # add EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY
npm run web                         # or: npm run ios / npm run android
```

`.env.local` may only contain `EXPO_PUBLIC_*` values that are safe to publish. Never put a secret, service-role key, or vendor API key in it.

## Supabase setup (one time, and on every change)

Fastest path — one command with a personal access token (Dashboard → Account → Access Tokens):

```sh
cp supabase/.env.example supabase/.env.local     # fill in vendor keys / Rippling app / linked POS logins
SUPABASE_ACCESS_TOKEN=sbp_… npm run supabase:release
```

This applies pending migrations, turns off signups and confirmation emails, raises the OTP verify rate limit, pushes the function secrets, and deploys both Edge Functions. Until it has run, the hosted project still allows signups and sends confirmation mail, and sign-in fails with "Could not reach the sign-in service."

The same steps individually (or with the Supabase CLI):

1. **Database**

   ```sh
   npm run supabase:push            # with the Supabase CLI linked to the project
   # or, without the CLI:
   SUPABASE_ACCESS_TOKEN=sbp_… npm run supabase:migrate
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

   That uses `npx supabase` (no global CLI install). If deploy returns 403, the CLI is signed into a different org — log in with the Canada Gold account (`npx supabase login`, then `npx supabase link --project-ref bkvyyddtevzvuanzkobd`) or deploy with a personal access token:

   ```sh
   SUPABASE_ACCESS_TOKEN=sbp_… npm run supabase:deploy:token
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
