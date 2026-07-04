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
