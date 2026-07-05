# Learning Log

> Plain-English record of new concepts introduced during the build, one entry per concept, with a
> pointer to where it's used in the code. Written as they come up — see `CLAUDE.md`'s teaching cadence.

---

## Session 1 (2026-07-04) — Supabase Projects, Schema & Auth Config

### Supabase
A hosted platform bundling Postgres, an Auth service (signup/login, JWT issuance, OAuth providers), and
file Storage under one project. Used instead of self-hosting each piece separately. Two projects exist:
`subscription-auditor-dev` and `subscription-auditor-prod`, kept fully separate so dev experimentation
never touches real data. See `backend/.env.example` for the variables the backend reads from it.

### Row-Level Security (RLS)
A Postgres feature that scopes every query against a table to only the rows a policy allows, evaluated
per-row regardless of who's asking — a second wall behind application code, so a bug or compromised
credential still can't leak other users' rows. Look here: `supabase/migrations/20260704152946_create_profiles_table.sql`,
the `ENABLE ROW LEVEL SECURITY` line and the four `CREATE POLICY` statements, all keyed on
`auth.uid() = id` (`auth.uid()` reads the caller's user id out of their JWT's `sub` claim).

### Postgres triggers + `SECURITY DEFINER`
A trigger attaches a function to fire automatically on a table event (here, `AFTER INSERT ON auth.users`)
so a `profiles` row is created the instant someone signs up, with no application code involved.
`SECURITY DEFINER` makes the function run with its *owner's* privileges rather than the caller's —
necessary here because the caller is Supabase's internal Auth service, which has no privilege to write
into `public.profiles` on its own. Look here: same migration file, the `handle_new_user()` function and
the `on_auth_user_created` trigger.

### Supabase CLI migration workflow
Schema changes are written as versioned, timestamped `.sql` files under `supabase/migrations/` instead of
being made by hand in the dashboard's Table Editor. `supabase migration new <name>` scaffolds a file;
`supabase link --project-ref <ref>` points the CLI at a specific project; `supabase db push` applies
pending migration files to that project. The same files get applied to dev first, then prod, so both
databases are guaranteed to go through an identical, reviewable history of changes.

### JWT secret vs. API keys
Two different Supabase credentials serve different purposes: the anon/service-role keys identify *which
application* is calling Supabase's API (like an API key), while the JWT secret is what the backend will
later use to independently verify a *user's* session token (proving who they are) without calling back
to Supabase for every request. Both are populated in `backend/.env` but only the JWT secret is about
authenticating individual users.

### Google OAuth (sign-in flow)
"Sign in with Google" is OAuth 2.0: the app redirects to Google, Google authenticates the user and asks
for consent, then redirects back to a pre-registered URL with a temporary code. Google only redirects to
URLs registered in advance ("authorized redirect URIs") — here that URL is Supabase's own callback
(`https://<project-ref>.supabase.co/auth/v1/callback`), since Supabase (not the FastAPI backend) is the
one that exchanges the code for the user's identity and issues the session JWT. Configured in the
Supabase dashboard under Authentication → Providers → Google, using a Client ID/Secret created in the
Google Cloud Console.

---

## Session 2 (2026-07-04) — JWT Verification & RLS Data Layer

### JWT verification (signature, `exp`, `aud`/`iss`)
Verifying a JWT means checking three independent things before trusting any of its claims: (1) the
cryptographic signature matches the issuer's key (proves it wasn't forged or altered), (2) `exp`
hasn't passed (proves the session hasn't expired), (3) `aud`/`iss` match what's expected (proves the
token was issued *for this API* by *this Supabase project*, not some other service). `jwt.decode(...)`
checks all three in one call and raises on any failure. Look here: `backend/app/deps.py`,
`verify_token()`.

### JWKS and asymmetric (ES256) vs. symmetric (HS256) signing
A real token from this project was inspected and found to use `ES256` (elliptic-curve, asymmetric),
not the HS256 shared-secret scheme `SUPABASE_JWT_SECRET` implied — see `docs/adr/0001-jwt-verification-via-jwks-es256.md`.
With asymmetric signing, Supabase's Auth service holds a private key that signs tokens; JWKS
(`.well-known/jwks.json`) publishes only the matching *public* key, so a verifier can never forge a
token even if compromised — unlike a leaked HS256 shared secret, which could. `PyJWKClient` fetches
and caches that public key by `kid`. Look here: `backend/app/deps.py`, `_jwks_client`.

### FastAPI dependency injection
A "dependency" is a reusable callable declared as a route parameter's default (`Depends(fn)`).
FastAPI calls it before the route body runs and either passes its return value in as an argument, or
lets its exception propagate (short-circuiting the route entirely) — the mechanism used here to turn
"no valid token" into a 401 before any route or business logic executes. Look here:
`backend/app/routers/me.py`, `Depends(get_current_claims)`.

### RLS enforcement from the app layer via `SET LOCAL`/`set_config`
Postgres RLS policies (Session 1) read the caller's identity from a per-connection setting,
`request.jwt.claims`, via `auth.uid()`. `set_config(name, value, is_local=true)` is the parameterized
equivalent of `SET LOCAL name = value` — it only takes effect **inside an explicit transaction** and
is automatically cleared when that transaction ends. That scoping is what makes it safe to reuse a
pooled connection across different users' requests: without an explicit transaction, the setting
silently no-ops and the query runs under the connection's default (superuser) privileges, bypassing
RLS entirely. Look here: `backend/app/db/rls.py`, `rls_connection()`.

### `asyncpg.Pool` + FastAPI lifespan
A connection pool keeps a set of reusable database connections open instead of establishing a new
one per request (which would exhaust Postgres under load). FastAPI's `lifespan` is an async context
manager that runs once at startup (before the app accepts requests) and once at shutdown — the
natural place to create and close a pool exactly once, rather than per-request. Look here:
`backend/app/main.py`, `lifespan()`; `backend/app/db/pool.py`.

### ASGI middleware vs. FastAPI dependencies (ordering)
Both can intercept requests, but at different points: a `Depends(...)` dependency runs *after*
FastAPI has matched a route, as part of resolving that route's parameters — an exception it raises
(like our 401) means the request never entered the route body, but request-level middleware still
saw it happen. `BaseHTTPMiddleware` wraps the *entire* ASGI app, including routing, so it runs before
any route-specific dependency. This is why rate limiting here is middleware, not a decorator: a
decorator-based limiter tied to the route function would never trip on repeated invalid-token
requests, because those get rejected during dependency resolution before the decorated function body
runs. Look here: `backend/app/middleware/rate_limit.py`.

### Constant-time comparison (`hmac.compare_digest`)
Plain `==` on two strings/bytes short-circuits at the first differing byte, so comparison time
leaks how many leading bytes matched — an attacker measuring response time can recover a secret one
byte at a time. `hmac.compare_digest` always takes the same time regardless of where (or whether) the
inputs differ. Not yet used against a real secret this session (no token-hash comparison exists
yet), but established as the pattern for the extension-token check in a later session. Look here:
`backend/app/security/compare.py`.

## Session 3 (2026-07-04) — Frontend Skeleton

### Vite
Vite is the frontend build tool and dev server. In dev it serves source files directly as native ES
modules and only transforms what the browser actually requests, instead of bundling the whole app
upfront (the older Webpack/CRA model) — that's what makes startup and hot-reload near-instant even
as the app grows. For production it switches to a Rollup-based bundle. Look here: `frontend/vite.config.ts`.

### Tailwind CSS (utility-first, v4 CSS-first config)
Instead of hand-writing CSS classes and switching files, styling is composed from small
single-purpose utility classes directly in JSX (`className="p-4 rounded-lg bg-slate-900"`). Tailwind
v4 configures itself from CSS (`@import 'tailwindcss'` plus `@theme`/CSS variables) rather than a
separate `tailwind.config.js`. Unused utilities are stripped at build time. Look here:
`frontend/src/index.css`, `frontend/vite.config.ts` (`@tailwindcss/vite` plugin).

### shadcn/ui (copy-paste ownership, not a package)
shadcn/ui's CLI copies component source (e.g. `Button`) directly into the repo under
`src/components/ui/`, built on accessible primitives and styled with Tailwind, rather than installing
an opaque component library from `node_modules`. The tradeoff vs. a prebuilt kit (MUI, Chakra): more
files to own and maintain, but no fighting a vendored API when a one-off tweak is needed. This
project's generator used Base UI primitives (`@base-ui/react`) rather than Radix — its polymorphism
API is a `render` prop, not Radix's `asChild`, which is why `Landing.tsx` applies `buttonVariants()`
to a `Link` directly instead of wrapping `<Button asChild>`. Look here:
`frontend/src/components/ui/button.tsx`, `frontend/components.json`.

### Dark mode as default (`class` strategy)
shadcn/ui's generated CSS defines two variable sets — `:root` (light) and `.dark` (dark) — selected
by a `dark` class rather than the OS-level `prefers-color-scheme` media query. Applying `class="dark"`
directly on `<html>` in `index.html` makes dark the default regardless of OS setting, while still
leaving room for a future user-toggle to swap the class at runtime. Look here: `frontend/index.html`,
`frontend/src/index.css`.

### React Router v6
Client-side routing swaps components in place as the URL changes, without a full page reload.
`<BrowserRouter>` wraps `<Routes>`/`<Route>` elements matched against the current path. This session
only adds placeholder routes (a landing page and a dashboard stub) with no auth guarding — that's the
next task. Look here: `frontend/src/App.tsx`, `frontend/src/routes/`.

### react-i18next (keyed strings from the start)
Display strings are looked up by key (`t('landing.cta')`) against per-language JSON files rather than
hardcoded in JSX, so every string has a translation slot from day one instead of a retrofit later.
`en` and `el` locale files are loaded eagerly and registered with `i18next-browser-languagedetector`
for automatic language detection. Look here: `frontend/src/i18n/index.ts`,
`frontend/src/i18n/locales/`.

### TanStack Query (server state, not raw `useEffect` + `fetch`)
TanStack Query manages data fetched from an API — caching, deduplication, background refetching,
loading/error state — so components don't hand-roll that bookkeeping with `useEffect` and `useState`.
A single `QueryClient` is created once and provided via `QueryClientProvider` at the app root, even
though no queries exist yet; the next task's `GET /api/v1/me` call will be the first consumer. Look
here: `frontend/src/App.tsx`.

### Client library shape for the next task's auth flow
`src/lib/supabase.ts` exports a singleton Supabase browser client built from `VITE_SUPABASE_URL` /
`VITE_SUPABASE_ANON_KEY` — safe to expose client-side because RLS enforces real access control
server-side. `src/lib/api.ts` exports `apiFetch(path, options)`, where `options.accessToken` (if
present) is turned into an `Authorization: Bearer <token>` header; the next task's auth flow supplies
that token from the Supabase session without needing to touch this file's structure. Look here:
`frontend/src/lib/supabase.ts`, `frontend/src/lib/api.ts`.

## Session 4 (2026-07-05) — Quality Baseline & Pre-commit

### The pre-commit framework
A git-hook manager that reads a version-controlled `.pre-commit-config.yaml` instead of hand-written
scripts in the untracked `.git/hooks/` folder. For each configured hook it builds an isolated, pinned
environment (its own venv/Node install) to run that one tool, so `ruff` and `eslint` run sandboxed
regardless of what's on the developer's machine. `pre-commit install` wires it into `git commit`;
`pre-commit run --all-files` runs every hook on demand without committing. Look here:
`.pre-commit-config.yaml`.

### Pinned hook revisions (supply-chain hygiene)
Each hook entry points at a public git repo (e.g. `astral-sh/ruff-pre-commit`) that pre-commit clones
and executes. Pinning to an exact tag rather than a floating branch (`main`) means a maintainer's
future push can't silently change what code runs on every commit — the same reasoning as pinning
`pyproject.toml`/`package.json` versions, applied to hook definitions. Look here:
`.pre-commit-config.yaml`, the `rev:` field on each `repo:` entry.

### Local hooks for a project's own toolchain
The frontend's `eslint.config.js` (flat config) depends on plugins (`typescript-eslint`,
`eslint-plugin-react-hooks`, etc.) that a generic pre-commit mirror hook can't see, since the mirror
runs eslint in its own isolated environment without those plugins installed. A `repo: local` hook
with `language: system` instead shells out to the frontend's *own* `node_modules/.bin` tools, so it
sees the exact plugin set already installed via `npm install`. Look here: `.pre-commit-config.yaml`,
the `eslint`/`prettier` local hooks.

### Secret scanning (`gitleaks`)
A hook that inspects the staged diff for patterns that look like credentials (API keys, private keys,
tokens) before a commit is created. Once a secret is committed, deleting the file later doesn't remove
it from history — it's still recoverable from old commits — so blocking at commit-time is the only
point where removal is actually free. Verified by staging AWS's own publicly documented example access-key-ID format (the standard
placeholder AWS uses in its docs, distinguishable by an `EXAMPLE` suffix) and confirming `gitleaks`
rejected the commit attempt (`aws-access-token` rule) before it was removed and a clean commit
succeeded. Look here: `.pre-commit-config.yaml`, the `gitleaks` hook.
