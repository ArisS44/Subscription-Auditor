# Project Decisions

> Durable record of cross-session decisions that aren't captured by the spec or code.
> Survives APM session archiving. Add to the top as new decisions are made.

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
