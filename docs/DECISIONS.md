# Project Decisions

> Durable record of cross-session decisions that aren't captured by the spec or code.
> Survives APM session archiving. Add to the top as new decisions are made.

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
