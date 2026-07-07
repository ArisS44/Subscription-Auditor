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

## Session 5 (2026-07-05) — Auth Flows & Protected Page

### CORS (Cross-Origin Resource Sharing)
Browsers enforce the same-origin policy: JS on `http://localhost:5173` is blocked by default from
reading responses from `http://localhost:8000` — different port means different origin, and only the
*server* can opt in via response headers, not the client. Any request that isn't a "simple" GET/POST —
our `GET /me` with a custom `Authorization` header qualifies — triggers an invisible preflight
`OPTIONS` request first, asking permission before the real request is sent. FastAPI's `CORSMiddleware`
answers both the preflight and adds the allow-origin headers to real responses. It's added outermost
of all middleware (added last, since Starlette wraps in reverse-add order) so preflight requests are
answered before ever reaching the per-IP rate limiter — a legitimate cross-origin caller's preflight
shouldn't be able to trip a limit meant for the real request. The allowed origin comes from
`CORS_ALLOW_ORIGINS`, not a hardcoded string, so a later Stage-4 task can add the production frontend
origin without touching code. Look here: `backend/app/main.py`, `backend/app/config.py`
(`cors_allow_origins_list`).

### Supabase Auth client flows (signup, login, OAuth, reset, logout)
All of these are just methods on the `@supabase/supabase-js` client, calling Supabase's own Auth API
directly from the browser — no custom backend endpoints needed for auth itself (the backend only
verifies the resulting JWT). `signUp` triggers a confirmation email when email confirmation is
required; `signInWithPassword` exchanges credentials for a session; `signInWithOAuth({ provider:
'google' })` redirects to Google and back; `resetPasswordForEmail` + `updateUser({ password })` cover
the two-step password-reset flow (request link → set new password from the temporary session the
link establishes); `signOut` revokes the refresh token. Learned live: Supabase deliberately returns a
*fake success* from `signUp` for an already-registered email — no error, no email sent, no new record
— specifically to prevent email-enumeration attacks (an error would let an attacker probe which
addresses have accounts). Look here: `frontend/src/routes/auth/`.

### Protected routing / route guards
A guard is just a component that reads auth state and either renders its children or redirects. The
subtlety is the async gap on first load: Supabase needs a moment to check storage for an existing
session before we know if the user is authenticated, so the guard must render nothing (not redirect)
during that loading window — otherwise every page load flashes a redirect to `/login` and back, even
for already-logged-in users. `onAuthStateChange` is the single source of truth for session state
afterward, kept in a `React.Context` at the app root so any component can read it. Look here:
`frontend/src/features/auth/AuthProvider.tsx`, `ProtectedRoute.tsx`.

### Session persistence and "remember me"
Supabase persists the session to `localStorage` and auto-refreshes it by default — that's what "stay
logged in across reloads" means out of the box, with no extra code. To make "remember me" an actual
per-login choice, the client takes a custom `storage` adapter instead of the default: a small wrapper
that checks a flag (`auth-remember-me`, set right before sign-in) and routes reads/writes to either
`localStorage` (survives browser restarts) or `sessionStorage` (cleared when the tab closes). Look
here: `frontend/src/lib/supabase.ts`.

### Vitest + React Testing Library
Vitest reuses Vite's own transform pipeline for tests (no separate Babel/webpack config) and exposes a
Jest-compatible API. React Testing Library renders components into a simulated DOM (`jsdom`) and
queries them the way a user would (by visible text/role), so tests survive internal refactors. The
smoke test mocks `@/lib/supabase` entirely rather than hitting the real network, so it verifies the
*guard's* redirect logic deterministically without depending on Supabase being reachable or a session
existing. Look here: `frontend/vite.config.ts` (the `test` block), `frontend/src/test/setup.ts`,
`frontend/src/features/auth/ProtectedRoute.test.tsx`.

## Session 6 (2026-07-06) — Azure Provisioning

### Resource groups, ACR, and Container Apps
A resource group is just a logical bucket — everything provisioned lives inside one so it can be
deleted or audited as a unit. Azure Container Registry (ACR) is a private Docker registry; CI pushes
images there and the Container App pulls from there. A Container App runs on a shared "environment"
(networking/logging boundary) and can scale to zero replicas when idle, so it costs roughly nothing
between requests — the tradeoff is a cold start on the next one. Look here: `infra/azure/README.md`
§§1-3.

### Managed identity + Key Vault secret references
Rather than embedding credentials, the Container App gets a system-assigned managed identity (its own
service-principal-like identity with no password to leak), then narrow Azure RBAC roles (`AcrPull`,
`Key Vault Secrets User`) are granted to that identity, scoped to just the one ACR and one Key Vault it
needs. Key Vault holds the real secret values; the Container App's own "secrets" are just references
(`keyvaultref:<uri>,identityref:system`) resolved at startup via that identity — the plaintext value
never sits in the Container App's own config. Role-assignment propagation can lag a minute or two after
creation. Look here: `infra/azure/README.md` §§3-4.

### Static Web Apps region constraints (two separate restriction layers)
Learned live, the hard way: a subscription-level Azure Policy (`sys.regionrestriction`, common on Azure
for Students subscriptions) can block deployments to most regions — but even once that's lifted,
Static Web Apps has its *own* separate fixed list of supported hosting regions, independent of general
Azure region availability (e.g. `germanywestcentral`, used for every other resource here, isn't on that
list; `westeurope` is). Both restrictions have to be satisfied, not just one. Look here:
`infra/azure/README.md` §5.

### Subscription upgrade instead of subscription move
Assumed going in that an Azure for Students subscription couldn't convert in place to Pay-As-You-Go and
would require standing up a brand-new subscription (with the existing resources needing to move or be
recreated there). In practice, the Portal's Cost Management → "Upgrade" flow converted the *same*
subscription (identical subscription ID) to Pay-As-You-Go directly, preserving every already-provisioned
resource with no move/recreate step needed, and it removed the region-restriction policy as a side
effect. A subscription-level Budget with threshold alerts (50/80/100% of a fixed cap) was set up
immediately after, since Pay-As-You-Go has no spending limit by default the way the student offer did.
Look here: `infra/azure/README.md` (Region note / Subscription note under §5).

### GitHub Actions: workflows, jobs, steps, and triggers
A workflow is a YAML file in `.github/workflows/` describing automation triggered by repo events —
`on: push: branches: [main]` means "run on every commit landing on `main`," optionally narrowed further
with `paths` so unrelated changes don't trigger it. A workflow holds one or more jobs, each running on
its own fresh virtual machine in parallel by default (`needs: <job>` forces ordering — used here so the
backend's image only builds/deploys after its test job passes). Each job is a sequence of steps: either a
shell command (`run:`) or a reusable action (`uses: owner/action@version`). `workflow_dispatch` adds a
manual "Run workflow" button — but critically, GitHub only lists a workflow for manual dispatch once that
workflow file exists on the repository's *default* branch; a workflow only present on a feature branch
can't be dispatched from the Actions UI, discovered live when trying to validate before the first merge.
Look here: `.github/workflows/backend.yml`, `.github/workflows/frontend.yml`.

### OIDC federated credentials for CI → Azure auth
Rather than storing a long-lived Azure credential as a GitHub secret, an Azure AD app registration can
trust GitHub's own short-lived, cryptographically-signed OIDC tokens directly via a federated credential.
The credential's `subject` field (`repo:<org>/<repo>:ref:refs/heads/main`) is the trust condition — only
workflow runs matching that exact subject (this repo, this branch) can authenticate as that identity, and
there's no secret to rotate or leak. `azure/login@v2` exchanges the run's GitHub-issued token for a real
Azure access token at run time, scoped to whatever narrow RBAC roles (`AcrPush`, `Container Apps
Contributor`) were granted to the app registration. Look here: `.github/workflows/backend.yml` (the
`azure/login` step).

### Static Web Apps navigation fallback (SPA routing on a static host)
A static file host has no idea a URL like `/dashboard` is a React Router client-side route rather than a
literal file — so a direct load or hard refresh on any non-root path 404s unless told otherwise. A
`staticwebapp.config.json` with a `navigationFallback` rule (rewrite unmatched paths to `/index.html`,
excluding real static-asset patterns) tells Azure to hand unmatched requests to the SPA's own router
instead. Vite copies anything placed in `frontend/public/` into the built `dist/` unchanged, which is how
this file ends up at the deployed site's root. Discovered live: refreshing the authenticated dashboard
page in production hit Azure's own 404 page instead of the app, since this file didn't exist yet. Look
here: `frontend/public/staticwebapp.config.json`.

### Supabase's Site URL vs. Redirect URLs allowlist
Two separate settings, easy to conflate: **Redirect URLs** is an allowlist of URLs OAuth/email-link
redirects are permitted to target; **Site URL** is the *default* redirect used when a flow (like an email
confirmation link) doesn't specify an explicit `redirectTo` — and it still defaults to
`http://localhost:3000` until changed, even after the allowlist has a real production URL in it. Missing
this caused a production confirmation email to redirect to `localhost`. Look here: prod Supabase project
→ Authentication → URL Configuration.

### Supabase's default email service is rate-limited by design
Supabase's built-in email sending (active with zero configuration) is capped at a low volume per hour —
adequate for occasional dev testing, not real user traffic. The Rate Limits panel exposes a configurable
number, but raising it has no effect without a custom SMTP provider (e.g. Resend, SendGrid) configured
first; only then does that number govern real throughput through your own provider. Sending to arbitrary
real recipients (not just your own verified test address) also generally requires a verified sending
domain. Deferred to a later session pending a domain purchase. Look here: prod Supabase project →
Authentication → Rate Limits.

---

## Session 7 (2026-07-07) — Subscriptions API

### RLS on a child table (generalizing the profiles pattern)
`profiles` is one row per user, keyed on its own `id` (which *is* the user's auth id), so its RLS policies
read `auth.uid() = id`. `subscriptions` is different: a user has *many* subscriptions, each with its own
random `id`, and ownership lives in a separate `user_id` foreign key — so every policy keys on
`auth.uid() = user_id` instead. Everything else transfers unchanged: `ENABLE ROW LEVEL SECURITY` plus four
per-operation policies. The INSERT policy uses `WITH CHECK` (not `USING`) because there is no pre-existing
row to filter — it validates the row being *written*, which is what stops a caller from inserting a row
owned by someone else. `ON DELETE CASCADE` on the `user_id` FK means deleting a user auto-deletes all their
subscriptions (part of the GDPR full-deletion story — no orphaned rows). Look here:
`supabase/migrations/20260707113207_create_subscriptions_table.sql`.

### Enums as CHECK constraints + Pydantic `Literal` (defense in depth)
Instead of Postgres `ENUM` types (painful to `ALTER` later), the three enums (`category`, `billing_cycle`,
`status`) are plain `TEXT` columns with a `CHECK (col IN (...))` constraint, and the *same* value sets are
mirrored in Pydantic as `Literal[...]`. These are two independent walls enforcing the identical rule:
Pydantic rejects bad input at the API boundary with a clean `422` before it touches the DB (fast, good UX);
the DB CHECK is the backstop that catches anything bypassing the model or coming through a raw SQL path.
Neither trusts the other — if the two lists ever drift, that's a bug. Pydantic field constraints add the
rest of the contract: `Field(ge=0, max_digits=10, decimal_places=2)` on `price` mirrors `NUMERIC(10,2)` and
`CHECK price >= 0`; `max_length` caps free-text `name`/`notes` (the TEXT columns are unbounded, so the
backend — the trust boundary — bounds them); typing dates as `date` rejects malformed values at parse time.
Look here: `backend/app/models/subscription.py` (the `Literal` aliases and `Annotated[..., Field(...)]`
constraints), enforced against the CHECKs in the migration above.
