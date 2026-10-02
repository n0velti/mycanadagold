# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v54.0.0/ before writing any Expo-related code. Install or upgrade Expo packages with `npx expo install <pkg>` so they match SDK 54 (React Native 0.81 / React 19.1). Do not follow older SDK guides.

This file is for agents. Operational setup (Supabase release, staff disable, key rotation) lives in `README.md` — keep that document; do not replace it.

# MyCanadaGold (`cgold`)

Staff-only tools for Canada Gold stores. One Expo app on web (primary), iOS, and Android. There is no public signup. Access requires an **active Aureus POS login**. The app talks to three POS tenants (East, GTA, PMX), a locked-down Supabase project, and third parties (AI, FINTRAC, Rippling, Gmail, Google reviews, Moneris, RingCentral) only through the `proxy` Edge Function.

Live web: `https://www.mycanadagold.ca` (Vercel also serves `https://mycanadagold.vercel.app`). Supabase project ref: `bkvyyddtevzvuanzkobd`.

## Stack

| Layer | What |
| --- | --- |
| App | Expo SDK **54**, React 19.1, React Native 0.81.5, `react-native-web` 0.21, Metro |
| Web | `expo export --platform web` → `dist/` (see `app.json` `web.output: "single"`) |
| Auth / data | Supabase Auth + Postgres RLS + Edge Functions (Deno) |
| POS | Aureus (`canadagoldeast.aureuspos.com`, `gta.aureuspos.com`, `canadianpmx.com`) |
| Hosting | Vercel static (`vercel.json`). Client modules stay in `lib/`, never `api/` |
| Lint | `eslint` + `eslint-config-expo` (flat config). Edge Functions are ignored |

There is **no test suite** and no GitHub Actions CI. Quality gates are `npm run lint` and `npm run build:web && npm run check:secrets`.

## Layout

| Path | Role |
| --- | --- |
| `App.js` | Shell: session, nav, Home, tool grid, lazy screen map. Very large — prefer editing a screen or `lib/` module over growing this file |
| `index.js` | Registers the root; loads typography first |
| `components/` | Screens (`*Screen.js`) and shared UI. Default-export screens |
| `lib/` | Client logic. `auth.js`, `proxy.js`, `supabase.js`, vendor clients |
| `lib/typography/`, `lib/actionLog/` | Metro wrappers. Do not import them directly from screens |
| `supabase/migrations/` | Schema, RLS, triggers. Additive SQL only |
| `supabase/functions/aureus-login` | Sign-in (`verify_jwt` off; it validates itself) |
| `supabase/functions/proxy` | Authenticated third-party gateway |
| `supabase/functions/trade-capture` | QR photo upload (`verify_jwt` off; token is the credential) |
| `supabase/functions/_shared/` | Aureus client, identity, JWT/staff checks, HTTP helpers |
| `scripts/` | `fix-web-export.js`, `check-bundle-secrets.js`, Supabase release helpers |
| `public/` | Web `index.html` (CSP) and `_headers` |
| `.env.example` / `.env.production` | **Client-safe** `EXPO_PUBLIC_*` only. Committed on purpose |
| `supabase/.env.example` | Function secrets template → `supabase/.env.local` (gitignored) |

## Run / build

```sh
npm install
cp .env.example .env.local          # EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY
npm run web                         # or: npm run ios / npm run android
npm run lint
npm run build:web && npm run check:secrets
```

`.env.local` may only contain `EXPO_PUBLIC_*` values. Metro inlines `process.env.EXPO_PUBLIC_*` at build time (dot-access only — no destructure). `expo export` loads `.env.production`. Never put a service-role, vendor, or POS password in either file.

Supabase (migrations, auth lockdown, secrets, functions) is `npm run supabase:release` with a personal access token. Details: `README.md`. Until that has run against a project, sign-in fails with "Could not reach the sign-in service."

Local web needs a real Aureus staff login. Preview and production share the **same** live Supabase + POS — there is no stub backend.

## Conventions

- **Language**: app is JavaScript + React Native. Edge Functions are TypeScript/Deno. Do not convert the app to TypeScript unless asked.
- **Imports**: `import { Text, Pressable, … } from 'react-native'` as usual. `metro.config.js` rewrites app-source `react-native` (and web Text/Pressable/TextInput/Animated) to Söhne + press logging. Do not bypass those wrappers. Do not edit `metro.config.js` unless the resolver itself is broken.
- **UI**: `StyleSheet.create`. Mobile breakpoint is 768 (`lib/mobileUi.js` `useIsMobile`). Canvas `#fcfcfb` / iOS-like greys. Font is Söhne via the wrappers — do not set `fontFamily` unless matching existing screens.
- **New tool**: add a key to `TOOL_CARDS` in `App.js`, `ALL_APP_KEYS` + role lists in `lib/permissions.js`, a `SCREEN_LOADERS` lazy import, and a `components/<Name>Screen.js`. Several catalog keys (Leaderboards, Police Report, Shipping, …) are placeholders with no screen yet.
- **Data**: POS reads go through `lib/auth.js` (`posFetch` / session tokens). Third-party HTTP goes through `lib/proxy.js`. Do not call vendor APIs from the browser.
- **Packages**: `npx expo install`. Prefer existing components (`MobileChrome`, `IosSettings`) over new UI kits.
- **SQL**: new `public` tables need RLS (`FORCE`) plus grants. Wrap `auth.uid()` / `is_active_staff()` in `(select …)` so Postgres can InitPlan (see `20260930153000_rls_auth_initplan.sql`).
- **Comments**: only where the why is non-obvious (auth, CSP, Metro). Match the surrounding voice.

## Risky to touch

Treat these as high-blast-radius. Read the existing module and `README.md` access model before changing them. Do not weaken checks to "make it work locally."

**Auth.** `LoginScreen` → Edge Function `aureus-login` → Aureus `/login`. The function (service role) finds/creates a pre-confirmed Auth user, upserts `public.profiles`, refuses `is_active = false`, and mints a session. The client never stores the POS password. Sessions live in `expo-secure-store` (native; AES key in the keychain) or origin-scoped `localStorage` (web). RLS `is_active_staff()` requires a JWT `app_metadata.aureus_user_id` that matches an active, verified profile — **not** `app_metadata.provider` (GoTrue resets that to `email`). Deactivating a profile revokes sessions.

**Proxy / secrets.** `proxy` re-checks the JWT and profile on every call. Vendor keys and OAuth client secrets are function secrets only. `npm run check:secrets` must stay green. `CGOLD_ALLOWED_ORIGINS` is CORS for the functions; if set, every live host (and any preview host you expect to sign in from) must be listed or browser login fails.

**Payments and cash.** `lib/payments.js` reads Aureus payment ledgers. `lib/moneris.js` + Debit app charge/poll Moneris Cloud via the proxy (branch managers configure terminals). Cash tills, counts, and breakdowns (`lib/cashTill.js`, `lib/cashCounts.js`, `lib/txnCashBreakdowns.js`) are live store money. Do not log amounts or card/terminal secrets.

**FINTRAC / PII.** `lib/fintrac.js` + `lib/fintracLctr.js` submit Large Cash Transaction Reports. Portal tokens and LCTR drafts (customer PII) stay in secure storage and go through the proxy. Do not persist report payloads in `console.log`, action logs, or client analytics.

**Other live systems.** Rippling HR/hours, Gmail, RingCentral (calls, recordings, AI), Google reviews, linked POS shared logins, trade-line photo tokens (`trade-capture`). `verify_jwt` is off on `aureus-login` and `trade-capture` on purpose — do not "fix" that without replacing the checks those functions already do.

**Web CSP / headers.** `public/index.html` CSP allowlists Supabase, the three POS hosts, and RingCentral. Production export strips `'unsafe-eval'` (`scripts/fix-web-export.js`). `vercel.json` / `public/_headers` set frame-deny, HSTS, and cache rules. Changing CSP or moving files under `api/` will break deploy or sign-in.

## Deploy (do not change Vercel project settings)

`vercel.json` builds `npm run build:web && npm run check:secrets` and publishes `dist/` as a static SPA (`framework: null`, clean URLs, rewrite everything except `/_expo/`, `/assets/`, `/fonts/`). Git integration is on: **`main` → Production**, other branches and pull requests → **Preview** (`vercel[bot]` comments a preview URL). Previews hit the same production Supabase; login from a `*.vercel.app` host only works if that origin is allowed by `CGOLD_ALLOWED_ORIGINS`.

Do not merge to `main` or deploy to production unless the user explicitly asks. Do not change Vercel project settings.
