# Project Decisions

> Durable record of cross-session decisions that aren't captured by the spec or code.
> Survives APM session archiving. Add to the top as new decisions are made.

---

## 2026-07-26 — iOS Web Push ships code-complete but on-device-unverified; frontend gets a strict CSP this session

**iOS verification — accepted unverified.** The Web Push opt-in, service worker, and PWA manifest are
implemented and the **desktop** path is live-verified (subscribe → notification displayed → click focuses
the dashboard). The **iOS on-device** path is not verified: iOS grants Web Push only to a Home-Screen-
installed PWA over HTTPS, which localhost cannot provide, and the developer currently has no iPhone. The
User chose to **ship the iOS code complete but unverified on-device** rather than block on borrowing a
device or a cloud real-device service. Consequence: iOS-specific install/delivery behaviour could contain
an undetected defect; the iOS instruction surface and manifest are written to spec but unproven on a real
device. If an iPhone/iPad becomes available later, the verification is a five-minute check against the
deployed HTTPS build (Share → Add to Home Screen → open installed → opt in → fire a test). The
session's acceptance criteria and Task 3.2 are adjusted so iOS on-device is an explicitly-accepted gap,
not an open failure. The desktop/Android Web Push path — the same standard — remains fully verified.

**Frontend CSP — added this session.** The app served by Azure Static Web Apps currently has **no
Content-Security-Policy** (`staticwebapp.config.json` defines only `navigationFallback`; the strict
`default-src 'none'` lives only on the backend API's own responses, which never serve the SPA). This is a
standing gap against the project's "ship a strict CSP" non-negotiable, pre-existing rather than introduced
by the notification work, but the new service worker and manifest make it timely. The User chose to
**close it this session before deploy** rather than defer to the Session 7 hardening pass. A strict policy
is added to the served frontend via `staticwebapp.config.json` global headers, allowing exactly what the
app legitimately loads — `worker-src 'self'` and `manifest-src 'self'` for the new PWA surface,
`connect-src` for the backend API and Supabase, and whatever the existing auth/CAPTCHA flow requires — and
**verified live** (login with Turnstile, chat SSE streaming, push registration, all API calls) so the
policy hardens without breaking the running app.

---

## 2026-07-24 — Reminder delivery is at-most-once, and the ledger key is channel-blind (a Session 7 decision deferred, not settled)

**Decision:** Session 4's reminder engine is deliberately **at-most-once**. It claims a
`notification_deliveries` row *before* attempting delivery (the mandated idempotency mechanism from the
scheduler decision), and any existing claim suppresses re-send. Two consequences are accepted for this
session and flagged for a future one rather than fixed now: (1) a reminder whose every device send fails
transiently is consumed and not retried, and (2) the ledger key `(user_id, subscription_id, kind,
due_date)` has **no channel dimension**, so once a renewal is claimed by push, the future **email**
channel will also be suppressed for that same renewal even though email never sent.

**Why accepted now:** at-most-once is the correct reading of "never double-send", which is the guarantee
that actually matters for a money reminder delivered to a device — a duplicate ping is worse than a missed
one, and the app's own Overview upcoming-renewals list is the standing authoritative fallback (Spec:
"delivery is best-effort", "must not present notifications as guaranteed"). Push-only ships this session,
so the channel-blindness is latent, not active. Adding a channel dimension or a retry-lease now would be
speculative design ahead of email's actual semantics, and a nullable-column migration later is cheap.

**How to apply (Session 7, when email lands as the second adapter):** this partially qualifies the
2026-07-22 "email as a second adapter, not a rebuild" entry — the *engine* is reusable untouched, but the
*ledger* is not channel-ready. Before email sends its first reminder, decide between: adding a `channel`
column to the ledger and its uniqueness key (each channel claims independently); or gating re-send on
`delivered_at IS NULL` with a retry lease (turning at-most-once into at-least-once-per-channel). Either
must preserve the exactly-once-**per-channel** guarantee — the fix must not reintroduce double-sends. The
engine already leaves `delivered_at` NULL when nothing delivered, which is the hook a retry scheme would
gate on. Note a prod backfill: existing rows would need `channel='push'` stamped.

---

## 2026-07-22 — Roadmap resequenced: notifications pulled into Session 4, usage-dependent work pushed behind the extension

**Decision:** Sessions 4–6 are resequenced before Session 4 begins. Session 4 becomes **Reminders &
Guidance** (push infrastructure + scheduler + renewal reminders + curated `service_guides` +
`get_subscription_guide`, plus an early fix for the onboarding first-login defect). Session 5 becomes
**Reports & Invoice Import**. Session 6 becomes **Browser Extension & Usage Intelligence**, absorbing
`get_recommendation`, `cost_per_hour_target`, cost-per-hour, and the usage heatmap. `docs/APM_SESSIONS.md`
is updated to match.

**Why:** the original Session 4 was half-blocked on data that does not exist until Session 6. Cost-per-hour
and the usage heatmap have no usage data at all; `cost_per_hour_target` is a threshold on a metric nothing
can evaluate (dead UI a user can set but never benefit from); and `get_recommendation` reasoning from price
and renewal date alone would have to be built twice — once thin, once properly once usage lands. Meanwhile
the notification work has been fully unblocked since Session 1: `profiles.renewal_lead_days` and
`profiles.monthly_review_enabled` have existed since the first migration, and `SettingsPanel.tsx` already
renders the notification switches *disabled* behind a "coming soon" badge. The User's product judgement was
that renewal reminders are what make this a usable product rather than a spreadsheet — it is the only
feature that reaches out to the user rather than waiting to be opened. Sequencing by data-readiness rather
than by the original thematic grouping delivers real value earlier and avoids building anything twice.

The monthly-review notification moved *with* reports into Session 5 rather than staying with the other
notifications, because its entire purpose is to surface a monthly report — shipping it in Session 4 would
mean a notification pointing at nothing.

**How to apply:** Session 4 must resolve the scheduler single-owner question rather than inheriting it (see
the entry below). Two items previously scoped into Session 4 have no backing data and are deliberately not
carried forward: **renewal history** on the detail view (subscriptions store only `next_renewal_date`; real
history needs a snapshot mechanism that does not exist and was unscoped work hiding in a one-line bullet) —
revisit it when there is a reason to build snapshots. When Session 5's report generator reuses
`services/analytics.py`, it must preserve the per-currency grouping invariant: Session 2 shipped a real bug
by ranking top expenses across currencies, and a report emitting a single blended total would reintroduce
that class of bug.

---

## 2026-07-22 — Reminder delivery: Web Push now, email as a Session 7 adapter (not either/or)

**Decision:** Renewal reminders ship over **Web Push only** in Session 4. Email reminders are not
cancelled — they are deferred to Session 7 and will arrive as a second delivery adapter rather than a
rebuild. The reminder engine (cron trigger, due-detection across per-user and per-subscription lead times,
the delivery ledger and its idempotency constraint, cancelled/paused suppression, and bilingual message
rendering) is kept **channel-agnostic**, with push as the only delivery implementation for now.

**Why:** email is blocked on infrastructure that does not exist yet. Real app email requires a custom SMTP
provider with a *verified sending domain*, which requires owning a domain — both already scheduled in
Session 7 ("purchase a domain", "Production auth email (custom SMTP)", the latter explicitly dependent on
the former). Supabase's built-in mailer is not an alternative: it is rate-limited and scoped to auth
emails, and Session 1 already hit that ceiling during testing. Shipping email now would mean either pulling
a domain purchase forward (cost, DNS, TLS, deliverability warm-up) or sending from an unverified domain
into spam folders. Web Push needs one free VAPID keypair.

On the merits the two are complementary rather than ranked. Email wins on reach and persistence (no
install, no permission prompt, no per-device opt-in, no iOS Home Screen requirement; a reminder about money
arguably belongs in an inbox as a record rather than a dismissible ping). Push wins on immediacy, zero
marginal cost, no deliverability lottery, no unsubscribe-link compliance surface, and — consistent with this
project's privacy positioning — no new sub-processor receiving the user's email address alongside their
subscription data. Expect most users to deny the push permission prompt, which is the strongest argument
for email eventually existing as the durable fallback.

**How to apply:** roughly 70% of the notification work is channel-agnostic and must be structured that way
from the start — "decide what to send" separated from "send it". This is the project's existing
`routers/ → services/ → db/` layering applied normally, **not** a speculative abstraction built for one
caller; the precedent is `services/llm.py`'s provider adapters, which already paid off when Groq was swapped
for Gemini in Session 3. When Session 7 buys the domain and wires SMTP for auth email, the email reminder
adapter becomes near-free work against an engine that already exists. Adding email will also require a
Privacy Policy update for the new sub-processor (same pattern as the 2026-07-13 Google/Gemini entry).

---

## 2026-07-22 — Scheduler single-owner question resolved: external cron, not in-process APScheduler

**Decision:** Scheduled work runs via a **GitHub Actions cron pinging a token-protected `/jobs/run-due`
endpoint** on the backend, not in-process APScheduler. Idempotency comes from a delivery-ledger table with
a uniqueness constraint on (user, subscription, renewal date), so a duplicate or retried ping cannot send a
duplicate notification. `minReplicas: 0` is preserved — the ping itself wakes the container.

**Why:** `ENGINEERING_STANDARDS.md` §A flags in-process APScheduler across horizontally-scaled replicas as a
**correctness** bug, not a cost annoyance: every job fires N times, meaning N reminders and N reports. It
required a single-owner mechanism and set the deadline at "before Session 5" — pulling notifications into
Session 4 brought that deadline forward. Of the sanctioned options (advisory lock / dedicated single-replica
scheduler / external pinger, per spec §9.4), the external pinger is strictly simplest: $0, no always-on
replica, no APScheduler dependency, no leader election, and no scheduler process that needs to exist while
the app is scaled to zero. The advisory-lock alternative would have required `minReplicas: 1` (~$5–15/mo)
purely so a process exists to fire the job. It is also philosophically consistent with ADR 0003's
lazy-refresh FX cache — this project consistently prefers "do the work when something asks" over "run a
process that waits."

**How to apply:** authenticate the ping with a shared job token using the **already-written but currently
uncalled** `backend/app/security/compare.py` constant-time compare (written for the Session 6 extension
token; this is its first real use). The job token lives in Key Vault and as a GitHub Actions secret. Note
that this introduces the project's first **user-less** backend work: a scheduled job has no JWT and must
legitimately act across all users, so it needs service-role access that bypasses RLS. Draw that boundary
tightly — it is the first genuine least-privilege decision in the codebase, and every other endpoint to date
runs under a user's JWT with RLS scoping it.

---

## 2026-07-16 — Chat multi-currency chart quality: deferred, not fixed this session

**Decision:** Leave the chat agent's multi-currency chart behavior as-is for Session 3. The bigger fix
(an FX-convert tool or a base-currency mode for `get_analytics`, letting the assistant answer "show
everything in EUR") is deferred to a future session, not built now.

**Why:** Task 2.2 found that for a multi-currency portfolio, the assistant currently flattens
mismatched-scale currencies into one meaningless chart (e.g. plotting ¥14,161 next to €55.9 on one axis)
because `get_analytics` has no conversion and a chart payload has only one `currency` field. In-chat
currency conversion was already explicitly scoped out of Session 3 (see the 2026-07-09 entry above,
"Currency Conversion" is Overview-only this session) — registering a real FX-convert tool would be a
scope expansion, not a bug fix, so it doesn't belong in this session's remaining work.

**How to apply:** when this is picked up, the smallest correct fix is prompt-level (instruct the model to
render one chart per currency, or ask the user which currency to focus on, rather than mixing scales) —
that alone resolves the "meaningless chart" symptom without new scope. A real FX-convert tool or
base-currency `get_analytics` mode is the larger, separate feature that actually lets the assistant
answer "how much do I spend total in EUR" — track both as distinct options for whichever future session
picks this up, per auto-memory `chat-cross-currency-and-fx-gap`.

---

## 2026-07-13 — LLM provider migration: Groq → Gemini Flash (Claude Haiku 4.5 fallback)

**Decision:** Migrate the chat engine's default LLM provider from Groq (`llama-3.3-70b-versatile`) to
**Gemini Flash**, budgeted at ~€10. If Gemini's tool-calling quality disappoints in practice, the fallback
is **Claude Haiku 4.5** — both are config-level swaps behind the `llm.py` provider-agnostic wrapper (per
the 2026-07-09 "LLM layer" decision), not an engine rewrite.

**Why:** Task 1.6 root-caused the turn-2 HTTP 413 bug to Groq's free `on_demand` tier — `llama-3.3-70b-
versatile` is capped at 12,000 tokens/minute and 100,000/day. Because a single chat turn can fire several
tool-loop iterations (each resending system prompt + history + tool schemas), a handful of quick turns
exhausts the per-minute window and the *next* turn 413s regardless of its own size. This makes real
multi-user testing impractical on Groq's free tier; the graceful `reason="rate_limited"` handling Task 1.6
added is the right degradation behavior but doesn't fix the underlying capacity ceiling.

**How to apply:** add a Gemini adapter to `llm.py` alongside the existing Groq adapter; extend
`tools.py::_provider_safe_schema` for Gemini's stricter function-calling schema (flatten `anyOf`/`$ref`,
inline `$defs` — safe because `tools.dispatch` independently re-validates every payload against the real
Pydantic model regardless of what schema was sent to the provider). Live-verify all 10 registered tools
fire correctly against Gemini, plus re-check the three Task 1.6 symptoms don't regress on the new
provider. Confirm multi-turn rate-limit behavior no longer hits a wall under the paid tier. If Gemini's
tool-calling proves unreliable in that verification pass, fall back to Claude Haiku 4.5 instead of
persisting with Gemini.

## 2026-07-13 — New sub-processor (Google) requires a Privacy Policy update

**Decision:** The Gemini Flash migration above adds **Google** as a sub-processor (previously: Supabase,
Groq, Azure). The Privacy Policy must be updated to disclose this **in the same task as the migration**,
not deferred.

**Why:** GDPR requires disclosing all sub-processors handling user data; `CLAUDE.md`'s Privacy &
compliant non-negotiable already commits to this ("ship a Privacy Policy disclosing data collected +
sub-processors"). Shipping a provider swap without updating that disclosure would leave a live surface
non-compliant, which this project's standards treat as equivalent to shipping security half-done.

**How to apply:** whichever page/doc currently lists Supabase/Groq/Azure as sub-processors gains Google
(Gemini) alongside them (or replacing Groq's listing if Groq is fully retired rather than kept as a
documented fallback path). Verify this ships in the same commit/PR as the adapter change, not as a
follow-up.

---

## 2026-07-09 — Session 3 scope boundary + chatbot capability roadmap across sessions

**Decision:** The chatbot is a **conversational front-end over the same services the dashboard uses** —
it has no special powers; its reach = (tools registered in the in-process registry) × (data available).
Because tools live in a registry, later sessions make the bot smarter by *registering more tools into the
same chat loop*, with no rewrite of the engine. **Not an MCP server** — an in-process, provider-neutral
tool registry validated by Pydantic (single-agent tool-calling, per spec §3.3; no MCP network/auth
surface, nothing to reuse across external clients).

**Capability roadmap (which session gives the bot which ability):**
- **Session 3 — the "hands":** converse about subscriptions (bilingual, on-topic, refusals); full CRUD via
  chat (add / update / mark-cancelled / delete); query + analytics via chat (reuses S2 analytics); change
  settings via chat (`PATCH /me`); set the optional user-provided `manage_url` when adding; **inline
  charts + tables in chat** (`render_chart` / `render_table`, reusing S2 Recharts); **drive onboarding**
  (same bot, onboarding system prompt).
- **Session 4 — the "brain":** guidance ("how do I cancel Netflix" — curated `service_guides` → LLM
  fallback via `get_subscription_guide`); recommendations ("should I keep ChatGPT?" via
  `get_recommendation`); surface monthly insights. The "help cancel/subscribe" and "advise" abilities are
  Session 4, because they need the curated table + recommendation logic — in S3 the bot can *converse* and
  *act* on a subscription but not yet *advise*.
- **Session 6 — "sight":** richer usage / cost-per-hour answers and graphs, once real extension usage data
  exists.

**Chat memory:** three distinct memories — (1) **conversation memory** = the `conversations`/`messages`
tables persisted and replayed to the LLM as a **sliding window of ~20 messages** (spec §12.6); build this.
(2) The user's actual data is **NOT** held in chat context — it's queried live via tools every turn (DB is
source of truth). (3) **No** cross-conversation long-term memory (memory-tool pattern is out of scope).

**Graph variety is gated by available data:** in Session 3 `render_chart` can honestly draw only
spend-by-category (bar/pie), top-expenses (bar/table), monthly-burn/totals, and upcoming renewals
(table/list). Trend-over-time (needs historical snapshots) and usage/cost-per-hour/heatmap (needs
extension data) unlock in Sessions 4/6 — the tool is general, the honest chart set grows with the data.

**Session 3 IN / OUT (confirmed with User):**
- **IN:** the chat engine (LLM wrapper, tool registry, SSE streaming, conversation/message persistence,
  auto-titling, bilingual on-topic system prompt, chat rate limiting); CRUD + query/analytics + settings
  tools; optional per-sub `manage_url` (user-provided; **Option A** — curated auto-fill + LLM discovery
  stays Session 4); **minimal inline visuals** (`render_table` + spend-by-category chart to start);
  **onboarding shell** (welcome → choose-method → chat/manual/skip → done) with the extension and push
  steps as clearly-labeled "coming soon" stubs (those features are Sessions 6/5); the LLM abstraction and
  security caps from the entry below.
- **OUT (deferred):** `get_subscription_guide` + `get_recommendation` + curated `service_guides` seed +
  monthly reports (Session 4); real usage graphs (Session 6); richer chart types until their data exists.
- **Pulled into Session 3 as an added self-contained slice:** **live currency conversion** — opt-in
  "convert to [currency]" control, backed by a **lazy-refresh FX cache with a ~12h staleness TTL** (fetch
  on the first request after the TTL expires — **no APScheduler**, deliberately avoiding the unresolved
  scheduler single-owner question until Session 5; same user-visible accuracy as "refresh a couple times a
  day"). This supersedes the "post-deploy fast-follow" timing in the 2026-07-08 entry below — the design
  (per-currency stays default, conversion is opt-in and labeled an estimate) is unchanged.

**Why:** keeps Session 3 shippable and fully secured while making the model choice ("one provider-agnostic
wrapper, Groq by default") and the "get smarter over time via the tool registry" roadmap explicit, so
later sessions extend the same engine instead of re-litigating its shape. Folding currency conversion in
now (rather than waiting) was judged low-risk once the FX design avoided the scheduler question, and kept
the session's User-facing surface area from feeling arbitrarily split across two deploys.

---

## 2026-07-08 — Live currency conversion: scoped as an opt-in fast-follow after Session 2's deploy

**Decision:** Session 2 ships with **no live FX conversion** — per-currency grouping (never converted) stays
the design for everything built in this session, including the Stage 1.4 fix that ranks top expenses fairly
*within* each currency. Real FX conversion is confirmed as real, wanted scope, but explicitly scheduled as a
**fast-follow once Session 2's Stage 3 (prod migration + deploy) is live and verified** — not folded into the
current deploy.

When built, the shape is: **no default single-currency view anywhere** — every existing per-currency display
(burn, annualized, category spend, native top-expenses ranking) stays exactly as-is, permanently. On top of
that, add an **opt-in** "convert to [currency]" control in Overview, letting the User pick a target currency
to (a) see converted comparison totals and (b) compare top expenses fairly across currencies — clearly labeled
as an estimate, never silently blending into the real per-currency figures.

**Why:** matches the app's financial-honesty stance (never silently convert) while giving the User the
comparison view they actually want. Doing it after Stage 3 deploys means the already-verified Session-2 slice
ships on schedule, and FX work — a live external rate source, a caching/staleness strategy that doesn't need a
scheduler (avoid entangling with the pre-Session-5 scheduler single-ownership question), and a new small
`fx_rates`-style table/migration — gets scoped properly rather than rushed into the current deploy.

**How to apply:** when picking this up, design as: (1) a backend FX-rate fetch+cache layer against a reliable,
free, no-key source (e.g. Frankfurter/ECB-based rates) with a staleness TTL, no scheduler required (fetch
lazily when the cached rate is stale); (2) apply the conversion only at the point the User opts in — top
expenses' native per-currency ranking (Task 1.4) is unaffected and stays the default; (3) an Overview
currency-picker control that shows converted totals/top-expenses labeled as an estimate. Revisit
`docs/APP_DESCRIPTION.md` and this file together before committing to the exact approach, and update the
Session-2 Spec's "no FX conversion" language once this fast-follow actually starts.

---

## 2026-07-04 — Minimal schema for Session 1 (profiles only)

**Decision:** The first Supabase migration (`supabase/migrations/20260704152946_create_profiles_table.sql`)
creates only the `profiles` table — not the full data model described in `APP_DESCRIPTION.md`
(subscriptions, usage logs, invoices, etc.).

**Why:** the broader data model may still change as later sessions clarify requirements. Committing to
the full schema now risks migrations that need reworking before they're ever used. `profiles` is the one
table every other session depends on (it's tied to `auth.users` via the signup trigger), so it's the only
piece worth locking in now.

**How to apply:** future sessions add their own tables via new versioned migrations under
`supabase/migrations/`, following the same RLS pattern (`auth.uid() = <owning-column>`) established here.
Don't treat the current `profiles` schema as exhaustive — expect it to gain columns over time.

**Also noted:** the Supabase CLI's standard project layout is a top-level `supabase/` directory
(`supabase/config.toml`, `supabase/migrations/`), not the `infra/supabase/` placeholder the initial
monorepo scaffold created. The CLI's convention was kept as-is (it's what `supabase db push`, CI, and
all tooling expect by default); the `infra/supabase/.gitkeep` stub is currently unused.

---

## 2026-07-01 — Incremental delivery / MVP strategy

**Decision:** Build the 7 sessions as independently deployable slices (as `APM_SESSIONS.md` already
intends), and treat the deliverable as **adjustable at session boundaries**. Do not commit up front to
shipping all 7.

**Soft target:** MVP = **through Session 3** (deployed app with manual subscription CRUD + dashboard +
the AI chatbot + onboarding). Deploy it, use it, then **reassess** whether Sessions 4–7 (insights,
notifications, invoice import, browser extension, hardening) happen now or later.

**Natural stop-and-ship points, each fully usable & deployed:**
- After **Session 2** → manual subscription tracker + dashboard.
- After **Session 3** → + AI chatbot + onboarding (credible portfolio MVP). ← soft target
- After **Session 4** → + insights/reports. Everything past here is additive.

**Rules that keep mid-flight changes safe:**
- **Defer features only at session boundaries** — never ship a session's work with security half-done.
  The security standards in `ENGINEERING_STANDARDS.md` are not deferrable on anything user-facing that
  is live (e.g. XSS/rate-limiting on the chat must be complete before the chat ships).
- Modularity (`ENGINEERING_STANDARDS.md` §A) means deferring a later session leaves no broken
  dependencies — unused tables/flags just sit dormant until their session.
- Close each session cleanly in APM so `.apm/` records exactly where work stopped; resuming later is a
  documented restart, not archaeology.

**Why:** solo, ~5 hrs/day, learning-while-building with live-teaching mode on. Keeping the deliverable
adjustable protects momentum and guarantees something real is always live, while avoiding a
commitment to full v2 scope regardless of how the build feels partway through.

---

## 2026-07-23 — Backend test users: session-scoped and shared, with a per-test reset

**Decision:** The `user_a` / `user_b` fixtures in `backend/tests/conftest.py` no longer mint a fresh
Supabase user per test function. Two users are created once per session and shared by the whole suite,
and isolation is preserved by `_reset_user_data`, which wipes both users' rows and returns their profile
fields to signup defaults **before** each test.

**Why:** function-scoped user fixtures cost one real Auth Admin round-trip per test, and that cost grows
with every table added. Measured before the change: 74 users and 222 Auth round-trips per full run,
producing 1, 2 and 0 failures across three consecutive runs (and 8 in a run the previous day). The
failures were Supabase rate-limiting, surfacing as `AuthError: Invalid authentication credentials` at a
different test each run. After the change: 2 users and 6 round-trips, flat regardless of test count.

This mattered because the project mandates a real cross-user RLS denial test for every user-scoped table.
That rule is correct and stays — but it guarantees the user-creation rate climbs with each table, and the
number of failures a developer is trained to dismiss as environmental climbs with it. The failure mode
being avoided is a genuine regression waved through as noise.

**Why cleanup runs before each test, not after:** teardown-only cleanup is skipped when a test fails or
errors part-way, which leaves the *next* test to fail for an unrelated reason. Running it on setup makes
every test's starting state unconditional.

**The risk this trades into, and how it was closed:** a shared user with weak cleanup swaps a visible
flake for an invisible false pass, which is strictly worse. A cross-user denial test that passes because
the row was never created is indistinguishable from one that passes because RLS worked. This was closed
two ways. Structurally, every denial test now asserts the owner *can* read the row before asserting the
non-owner cannot, so an absent row fails the test rather than satisfying it (`test_rls.py` was the one
missing this and gained it). Empirically, RLS was disabled on all six user-scoped tables and the denial
tests were re-run: all six failed, confirming they detect a loss of denial rather than passing vacuously.
RLS was then restored and verified on. `test_fixture_isolation.py` demonstrates the reset itself — one
test deliberately leaves rows behind and the next asserts it cannot see them.

**Costs accepted:** full-run time rose from ~197s to ~250s, because each test now opens a connection and
issues seven cleanup statements. Reliability was the goal, not speed. The suite must also stay serial —
sharing two users across parallel workers would reintroduce cross-test interference, so `pytest-xdist`
cannot be added without revisiting this.

**Rejected alternatives:** keeping function scope but skipping the delete call (cuts round-trips by a
third, leaves the trajectory intact); sharing users without cleanup and hardening tests against leftover
rows (that is loosening assertions, which this project does not do to make a run go green); and running
Supabase locally in Docker, which removes the rate limit entirely rather than economising on it and
remains the better long-term answer — it was out of scope here and the Docker daemon is not currently
running on the dev machine.
