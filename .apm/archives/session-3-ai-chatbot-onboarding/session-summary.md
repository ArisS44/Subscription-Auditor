---
date: 2026-07-17T00:00:00Z
project: SaaS Subscription Auditor — Session 3: AI Chatbot & Onboarding
stages_completed: 3
total_tasks: 14
outcome: complete
---

# Session 3 Summary — AI Chatbot & Onboarding

## Project Scope

Session 3 built the flagship feature of the SaaS Subscription Auditor: **Apollon**, a bilingual (EN/EL),
streaming AI chatbot that manages subscriptions through natural language, plus a guided onboarding flow.
It layered a single-agent, tool-calling chat engine onto the existing Session-2 subscription CRUD +
analytics services (reusing them so per-user RLS isolation was inherited, not re-implemented), persisted
conversations, rendered charts/tables inline in chat, and shipped the security and cost controls a live
LLM-backed surface requires. Two self-contained slices were folded in: an optional per-subscription
manage/cancel link, and opt-in live currency conversion on the Overview. Definition of done: a user can
chat with Apollon to add/edit/cancel/delete subscriptions and ask analytics questions, see charts in
chat, complete onboarding, and all of it is rate-limited, cost-capped, CAPTCHA-guarded at signup, and
XSS-safe — deployed to production.

## Stages and Outcomes

**Stage 1 — Backend: Chat Engine, Tools, Data Layer & Security (7 Tasks, expanded from a planned 5).**
Built the chat schema (`conversations`, `messages`, `fx_rates`, `llm_usage`, `subscriptions.manage_url`)
with RLS and cross-user isolation tests (1.1); a provider-agnostic `llm.py` wrapper with a Groq adapter
and the canonical bilingual Apollon system prompt (1.2); a registration-based tool registry covering all
10 Session-3 tools with strict Pydantic validation (1.3); the SSE chat endpoint tying it together — the
tool-calling loop, persistence, auto-titling, inline-visual grounding, and the full rate/cost cap set
(1.4); a lazily-refreshed FX cache with no scheduler (1.5). Task 1.4's live Groq call satisfied the
Stage's holistic checkpoint directly.

The Stage reopened twice after live findings during Stage 2: **Task 1.6** fixed three real defects found
via the actual frontend (a fabricated tool result, a leaked internal tool name, a turn-2 HTTP 413) —
root-causing the 413 to Groq's free-tier 12K-tokens/min ceiling, not request bloat. That capacity ceiling
then drove **Task 1.7**: a full LLM provider migration to Gemini Flash (landing on `gemini-flash-lite-
latest` after the originally-intended models proved deprecated/overloaded), a Gemini-strict tool-schema
sanitizer, three real Gemini-specific history-replay bugs found and fixed, a Privacy Policy update
disclosing Google as a sub-processor, and a systematic bilingual prompt-validation pass the User
personally extended with a 15+-turn live conversation.

**Stage 2 — Frontend: Chat UI, Inline Visuals, Onboarding, Currency & CAPTCHA (5 Tasks).** The chat
module (2.1) paused mid-Task when live testing exposed the Stage-1 defects above, resuming only after
Tasks 1.6/1.7 landed — it finished with full design sign-off and a real duplicate-render bug fix caught
live by the User. Typed inline chart/table renderers reusing the dashboard's `CategorySpendChart`
conventions (2.2) and a resumable onboarding wizard reusing the chat component in onboarding mode (2.3)
followed as a clean batch. Currency control + `manage_url` + a User-requested playful "roadmap teaser"
(2.4) and Turnstile CAPTCHA (2.5) landed early without incident. Frontend test coverage grew from 20 to
109 tests, zero i18n drift between `en`/`el` throughout.

**Stage 3 — Production Deploy & Verification (2 Tasks).** Provisioned all production secrets (Gemini LLM
key, `CHAT_GLOBAL_DAILY_CAP=2000`, real Turnstile keys) and applied the migration to prod Supabase with
no history drift (3.1); then pushed `main` (31 commits) to trigger the real deploy, fixed one genuine
prod-only CI failure (an untyped Vitest mock that passed tests but failed the build's `tsc -b` check),
and walked the full live definition-of-done with the User on the real production site — all items passed
(3.2). **Session 3 is live in production.**

## Key Deliverables

- `backend/app/services/llm.py` — provider-agnostic LLM wrapper; `GroqAdapter` + `GeminiAdapter` behind
  one interface, selected via `LLM_PROVIDER`/`LLM_MODEL`/`LLM_API_KEY` env config.
- `backend/app/services/tools.py` — the tool registry + dispatcher (10 registered tools), with
  provider-aware schema sanitization (`_provider_safe_schema`, Gemini-strict variant) and the
  `render_chart`/`render_table` structured-payload validators.
- `backend/app/services/chat.py` + `backend/app/routers/chat.py` — the SSE tool-calling loop,
  conversation/message persistence, auto-titling, inline-visual grounding, and the full rate/cost cap set
  (`services/usage.py`, `db/usage.py`).
- `backend/app/services/fx.py` + `backend/app/routers/fx.py` — the lazy-refresh FX cache and conversion
  endpoints.
- `backend/app/services/prompts.py` — the canonical bilingual Apollon system prompt + onboarding variant,
  hardened across Tasks 1.2/1.6/1.7 for grounding, no tool-name leakage, and injection resistance.
- `frontend/src/features/chat/` — the full chat module: SSE streaming via `fetch`+ReadableStream,
  sanitized markdown (DOMPurify), the conversation sidebar, and typed chart/table renderers
  (`ChatChart.tsx`, `ChatTable.tsx`, `StructuredPayload.tsx`).
- `frontend/src/features/onboarding/` — the resumable onboarding wizard (`OnboardingFlow.tsx`,
  `OnboardingBanner.tsx`, `useOnboarding.ts`).
- `frontend/src/features/auth/Turnstile.tsx` — the Cloudflare Turnstile integration across
  signup/login/password-reset.
- `supabase/migrations/20260710091357_create_chat_schema.sql` — applied to both dev and prod.
- `docs/adr/0002-provider-agnostic-llm-layer-over-httpx.md`, `0003-lazy-refresh-fx-cache-no-scheduler.md`
  — architecture decisions.
- `docs/DECISIONS.md` — five new entries this session: the LLM-layer design, the Session-3 scope
  boundary/capability roadmap, the Gemini provider migration + sub-processor disclosure, and the deferred
  multi-currency chart fix.
- `CLAUDE.md` — new "AI chatbot & LLM integration" Rules block, and the tsc-vs-Vitest CI Rule.
- Production: live on Azure Container Apps (backend) + Static Web Apps (frontend), prod Supabase
  migrated, Key Vault provisioned, real Turnstile enforcing.

## Codebase State

A dedicated verification pass (see Notable Findings) cross-checked all 14 Task Logs' claims directly
against the codebase and git history: every claimed file exists with the expected content, every claimed
commit resolves in git (a few hashes were superseded by rehashing during a mid-session rebase/cherry-pick
correction — same content, different hash, not a discrepancy), and the architectural claims (provider
registry, tool registry, SSE loop, chat/onboarding frontend modules, FX service) all match reality.

The codebase evolved somewhat past what the original Spec/Plan described: Stage 1 gained two Tasks (1.6,
1.7) not in the original 5-Task plan, driven by live-testing findings rather than upfront design; the
Spec and Plan were both updated in-session to record this (see their `modified` frontmatter fields) so
they remain accurate historical documents, not just what was originally scoped.

**One stale doc line found:** `CLAUDE.md`'s `## Stack` line still reads "Groq (Llama 3.3 70B, tool-
calling, SSE)" — it was never updated when the default provider migrated to Gemini in Task 1.7, even
though `docs/DECISIONS.md` and `docs/ENGINEERING_STANDARDS.md` were correctly updated. Cosmetic only,
does not affect any functional claim.

Everything else planned for Session 3 is implemented and live; nothing is partial or missing.

## Notable Findings

- **Two mid-session pivots, both User-driven and both resolved cleanly.** Live frontend testing surfaced
  real backend defects mid-Stage-2, pausing frontend work until Stage 1 was reopened and fixed (Task
  1.6); the root cause of one defect (a hard provider rate-limit ceiling) then justified a full LLM
  provider migration (Task 1.7) rather than a workaround. Both were handled via Plan modification (new
  Tasks added, dependencies traced) rather than editing history.
- **A Manager branch-hygiene mistake was caught and corrected before it caused any real damage.** Task
  1.6's branch was accidentally cut from an in-progress feature branch instead of `main`, briefly landing
  unapproved frontend code on `main` via fast-forward merge. Caught before any Report Bus review, corrected
  via `git reset --hard` + selective cherry-pick since nothing had been pushed to `origin` yet — no work
  was lost.
- **Live-model validation repeatedly caught things stubbed tests could not:** a Frankfurter host redirect,
  a Groq schema-validator rejection of `Decimal` fields, a Gemini `thoughtSignature` replay requirement, a
  sliding-window truncation bug that broke every turn past ~20 messages, and a prod-only `tsc -b`/Vitest
  type-check gap. This pattern recurred enough to become a standing lesson: every LLM/chat Task in this
  session's Plan required a live verification step, not just unit tests, and each one earned its place.
  The Vitest gap became a permanent Rule in `CLAUDE.md`.
- **The User was closely involved in verification throughout**, not just at design sign-off points —
  personally live-testing the chat UI (catching the duplicate-render bug and the original three backend
  defects), running a 15+-turn conversation that confirmed the trickiest Gemini fix, and walking the full
  production DoD checklist directly on the live site.
- **A Worker Handoff occurred mid-batch** (Frontend Agent, during Stage 2's first batch) with no
  reclassification needed since no prior-Stage work existed for that Worker.
- **Shared-dev Supabase flakiness recurred across the session** (auth rate-limiting / connection-pooler
  drops under full-suite load) but never indicated an actual regression — isolated/targeted test runs
  were consistently green throughout.

## Known Issues

- **`CLAUDE.md`'s Stack line is stale** (still says Groq, not Gemini) — cosmetic, flagged for the docs
  update following this summary.
- **Multi-currency chat charts are a known, deliberately deferred gap.** For multi-currency portfolios,
  the chat agent either flattens mismatched-scale currencies into one meaningless chart, or correctly
  refuses to convert (no FX-convert tool is registered despite the app having a full FX layer). Decided
  2026-07-16: left as-is for Session 3; a real fix (FX-convert tool or a base-currency `get_analytics`
  mode) is deferred to a future session (see `docs/DECISIONS.md`).
- **Extension time-tracking scope broadened beyond the current spec.** The User wants the future browser
  extension's usage/time tracking to cover as many subscriptions as technically feasible, not just
  AI-tools-only as `docs/APP_DESCRIPTION.md` currently frames it — flagged for the Session 4-7 Planner to
  reconcile.
- **Onboarding's first-login auto-redirect affects pre-existing accounts**, not just new signups (any
  account with `onboarding_completed = false`, the DB default, hits the wizard once). One-time and fully
  skippable; a data migration could pre-mark established accounts if this is undesired going forward.
- **Rate-limit (`reason: "rate"`) error copy is unit-tested but was never observed firing live** — hard
  to trigger by hand at 30 msg/min. Not blocking, just less real-world-verified than every other path.
- **`gemini-flash-lite-latest` is a moving alias**, not a pinned model version — worth pinning to a dated
  model for reproducibility if this becomes a maintenance concern later.
- One untracked scratch file, `backend/scripts/chat_repl.py`, remains in the working tree — a throwaway
  live-testing REPL harness, deliberately never committed (documented as such in Task 1.7's log).
- One local commit (`7ab954a`, the tsc-vs-Vitest CLAUDE.md rule) had not been pushed to `origin` as of
  this summary — harmless to leave, since it's docs-only and doesn't affect any CI trigger path.

## Snapshot Notice

This summary reflects the session state as of 2026-07-17T00:00:00Z. The codebase may have diverged since
this summary was created.
