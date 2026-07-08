# Project Decisions

> Durable record of cross-session decisions that aren't captured by the spec or code.
> Survives APM session archiving. Add to the top as new decisions are made.

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
