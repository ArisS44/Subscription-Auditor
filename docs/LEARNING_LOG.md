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
