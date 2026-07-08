# Project Decisions

> Durable record of cross-session decisions that aren't captured by the spec or code.
> Survives APM session archiving. Add to the top as new decisions are made.

---

## 2026-07-08 — Currency conversion deferred, not built in Session 2

**Decision:** While reviewing the Session-2 Overview tab, the User asked for a "convert everything to one
currency" view. This was declined for this session and not built — per-currency totals + a single-currency
filter were shipped instead (see `frontend/src/features/analytics/OverviewPanel.tsx`).

**Why:** the app's Money Aggregation Semantics for Session 2 are explicit — currencies are grouped, never
converted, with no FX rates and no external FX API. Real conversion needs a live/periodically-updated FX rate
source (a new external dependency), a decision on which rate snapshot to use for historical accuracy, and
UI to disclose that a conversion is an estimate — none of that was scoped or built this session.

**How to apply:** treat "multi-currency conversion" as a real, distinct future feature — likely its own small
scope (an FX-rate integration + a documented rounding/staleness policy), not a two-line addition to Overview.
When picking it up, revisit `docs/APP_DESCRIPTION.md` and this file together before committing to an approach,
and update the Session-2 Spec's "no FX conversion" language once it's superseded.

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
