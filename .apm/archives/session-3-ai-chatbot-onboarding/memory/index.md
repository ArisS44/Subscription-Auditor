---
title: <Project Name>
---

# APM Memory Index

## Memory Notes

- Full backend pytest suite is unreliable as a single-shot gate against shared dev Supabase: the connection pooler drops/refuses connections under full-suite load, causing a different pre-existing test to fail each run (not a code regression). Targeted/isolated test runs are reliable. Relevant when deciding whether backend CI should run the full suite in one shot vs. batched, and when interpreting a future red full-suite run.
- `supabase db push` requires `supabase login` (an access token) in addition to `supabase link` — the relink alone is not sufficient to push migrations. Relevant for every future dev/prod migration Task.
- Groq's RE2-based function-calling validator rejects JSON Schema `pattern`/`format` keywords that Pydantic auto-generates for fields like `Decimal` (lookahead regex) — causes an HTTP 400 for the whole request, only caught by a live model call, never by stubbed tests. `backend/app/services/tools.py::_provider_safe_schema` strips these before sending tool definitions to the provider (safe because the dispatcher re-validates every payload against the real Pydantic model regardless). Relevant when adding any new tool argument model with a constrained/regex-bearing field, and when adding a second provider adapter (e.g. the documented Claude Haiku swap) — confirm the new provider's schema tolerance too.

- **Extension time-tracking scope broadened (User direction, Session 4-7 relevant).** The User wants the future browser extension's usage/time tracking to cover as many subscriptions as technically feasible, not just AI-tools-only as `CLAUDE.md`/`docs/APP_DESCRIPTION.md` currently frame it (with the caveat that a browser extension can only ever measure browser-based/web-app usage, not TV/native/offline). Not actionable in Session 3 — flag for the Session 4-7 Planner to reconcile the extension design/spec against this.

- **Gemini model selection is a moving target.** `gemini-2.5/3.5-flash` were 404 (deprecated for new API keys) or ~60% `503`-overloaded under light load when tested (2026-07-15); `gemini-flash-lite-latest` was stable (100% success in an 8-call probe) and is now the default. `gemini-flash-lite-latest` is a moving alias, not a pinned version — worth pinning to a dated model (e.g. `gemini-3.1-flash-lite`) later for reproducibility, and worth re-probing model availability if a future session touches the LLM layer, since provider model lineups shift.
- **Gemini's free tier is unusable for this app (20 requests/day on a new project)** — far below even Groq's free-tier ceiling. This project runs on Google Cloud Prepay (€10, auto-reload off, a genuine hard cap) plus an app-level `CHAT_GLOBAL_DAILY_CAP` tripwire. Relevant if cost/capacity questions come up again.
- **Gemini has provider-specific history-replay requirements** any future chat-loop change must respect: (1) a `thoughtSignature` on each function-call part must be replayed verbatim on the next turn or it 400s; (2) `contents` must begin at a user turn — the sliding history window must never truncate to start mid tool-exchange, or every subsequent turn 400s once a conversation grows past the window. Both are handled in `services/llm.py`/`format_messages`, but any future history-windowing change needs to preserve these invariants.
- The `<function/...>` tool-call-as-literal-text glitch (flagged from Task 1.6) is confirmed **Groq/Llama-specific** — does not reproduce on Gemini. Only relevant again if Groq is ever re-selected as the active provider.
- **The chat agent can't handle multi-currency analytics well.** `get_analytics` returns per-currency buckets with no conversion, so a chart/table request for a multi-currency portfolio either flattens mismatched-scale currencies into one meaningless chart, or the assistant correctly refuses to convert (no FX/convert tool is registered, despite the app having a full FX layer). In-chat conversion is confirmed out of Session-3 scope per the Spec; the meaningless-single-chart behavior is a smaller, separate correctness question. See auto-memory `chat-cross-currency-and-fx-gap`.
- **Onboarding's first-login auto-redirect affects any account with `onboarding_completed = false`**, not just new signups — since that's the DB default, every pre-existing account would hit the wizard once on next dashboard visit. One-time, fully skippable via the `entered` flag → banner handoff. Worth a data migration before a prod rollout if this is undesired for established accounts.

## Stage Summaries

### Stage 1 - Backend: Chat Engine, Tools, Data Layer & Security

Backend Data Agent completed all five Stage 1 Tasks cleanly, dispatched as three sequential batches
(1.1+1.2, then 1.3+1.5, then 1.4) on branches `feat/chat-schema-and-llm-layer`,
`feat/chat-tools-and-fx`, and `feat/chat-engine`, each merged to `main` after review with no follow-ups
required. The full chat engine now exists end-to-end: the `conversations`/`messages`/`fx_rates`/
`llm_usage` schema with RLS and a `manage_url` column (Task 1.1); a provider-agnostic `llm.py` over httpx
with a Groq adapter and the canonical bilingual Apollon system prompt (Task 1.2, ADR 0002); a
registration-based tool registry covering all 10 Session-3 tools with strict Pydantic payload validation
and security-hardened `render_chart`/`render_table` validators (Task 1.3); a lazily-refreshed FX cache
with no scheduler (Task 1.5, ADR 0003); and the SSE chat endpoint tying it together — the tool-calling
loop, message persistence, auto-titling, inline-visual grounding, and the full rate/cost cap set
(Task 1.4). Task 1.4 included a live end-to-end Groq call that satisfied the Plan's flagged Stage-1
holistic checkpoint directly (a real tool-executed, persisted, capped, streamed turn), so no separate
Stage-boundary verification pass was needed.

Two real bugs surfaced only through the live-model validation steps built into these Tasks' Guidance,
not the stubbed unit tests: Frankfurter's host moved to `api.frankfurter.dev/v1` with a 301 redirect
httpx doesn't follow by default (Task 1.5, fixed); and Groq's RE2 schema validator rejects Pydantic's
`Decimal`-derived `pattern` regex in tool JSON Schemas, causing a whole-request 400 (Task 1.4, fixed with
a schema-sanitizing pass that's safe because the dispatcher independently re-validates every payload).
Both are recorded as Memory notes for future provider/tool work. The shared-dev Supabase suite's
aggregate-load flakiness (auth rate-limiting / pooler drops, a different pre-existing test each full
run) recurred across the Stage but never indicated an actual regression — isolated/targeted runs were
consistently green.

**Stage reopened for Tasks 1.6-1.7.** Live frontend testing of Task 2.1 (Stage 2) surfaced three real
defects in the merged chat engine — a fabricated tool result, a leaked internal tool name, and a turn-2
HTTP 413 — prompting the User to pause all Stage-2 frontend work until the backend was fixed. Task 1.6
root-caused and fixed all three (413 traced to Groq's free-tier 12K-tokens/min ceiling, not request
bloat; two new system-prompt rules for action-integrity and internal-mechanics-hiding). That capacity
ceiling then drove a Manager/User decision (`docs/DECISIONS.md` 2026-07-13) to migrate the default LLM
provider to Gemini, which Task 1.7 executed: a new `GeminiAdapter`, a Gemini-strict tool-schema
sanitizer, three real Gemini-specific history-replay bugs found and fixed (a `thoughtSignature`
replay requirement, an orphaned-tool-result edge case, and a sliding-window truncation bug that broke
every turn past ~20 messages until fixed), a Privacy Policy update disclosing Google as a sub-processor,
and a systematic live validation pass (both prompt variants × both languages) that the User personally
extended with a 15+-turn live conversation confirming the trickiest fix. Landed on `gemini-flash-lite-
latest` after the originally-intended models proved deprecated or overloaded; moved to a paid Cloud
Prepay tier after discovering Gemini's free tier caps at 20 requests/day. A mid-Stage-2 dispatch mistake
(Task 1.6's branch was cut from the wrong parent, briefly landing Task 2.1's unapproved code on `main`)
was caught and corrected via reset + selective cherry-pick before it reached any Report Bus review,
with no lost work since nothing had been pushed to `origin`.

Along the way, a User-directed scope addition landed in Task 2.4 (a small, playful Overview "coming
soon" roadmap teaser) and a Session 4-7-relevant scope note surfaced (extension time-tracking should
cover more than AI-tools-only) — both recorded above and in the Plan/Spec at the time.

**Task Logs:**
- task-01-01.log.md
- task-01-02.log.md
- task-01-03.log.md
- task-01-04.log.md
- task-01-05.log.md
- task-01-06.log.md
- task-01-07.log.md

### Stage 2 - Frontend: Chat UI, Inline Visuals, Onboarding, Currency & CAPTCHA

Frontend Agent completed all five Stage 2 Tasks, across a Worker Handoff (instance 1 → 2 mid-batch) and
one significant mid-Stage pivot: live testing of Task 2.1 exposed the Stage-1 chat-engine defects that
triggered Tasks 1.6/1.7 (see above), pausing all frontend chat work until the backend was fixed. Once
unblocked, Task 2.1 was finished on a rebuilt branch (cherry-picked forward past the branch-hygiene
incident), gaining full design sign-off, a real duplicate-render bug fix the User caught live, and
localized handling for all six backend error reasons. Tasks 2.2 (typed chart/table renderers reusing the
dashboard's `CategorySpendChart` conventions) and 2.3 (a resumable onboarding wizard reusing the chat
component in onboarding mode and the existing add-subscription form) followed cleanly as a batch, each
with interactive User design sign-off and live verification against the real Gemini-backed backend.
Tasks 2.4 (currency control, `manage_url`, and the User-requested roadmap teaser) and 2.5 (Turnstile
CAPTCHA) landed early in the Stage without incident. Frontend test coverage grew from 20 to 109 tests
across the Stage, all green, with zero i18n key drift between `en`/`el` throughout.

Two Manager-authority fixes landed directly during review rather than through a dispatched Task: a dev
CORS allowlist widened to cover Vite's fallback ports (Task 2.1 finding), and `profiles.onboarding_completed`
exposed on the profile API (a gap between the Session-1 DB schema and the API layer that Task 2.3 needed).
Two real, out-of-Task-scope findings surfaced live and are carried forward rather than fixed here: the
chat agent's meaningless multi-currency charts / missing FX-convert capability, and the onboarding
auto-redirect's effect on pre-existing accounts (both above, and in Working Notes for the Stage 3 DoD walk).

**Task Logs:**
- task-02-01.log.md
- task-02-02.log.md
- task-02-03.log.md
- task-02-04.log.md
- task-02-05.log.md

### Stage 3 - Production Deploy & Verification

Infrastructure Agent completed both Stage 3 Tasks cleanly on its first initialization, closing out
Session 3. Task 3.1 provisioned everything the session's backend/frontend work needed in production —
relinked the Supabase CLI to prod and applied the chat-schema migration (no history drift this time),
set the Gemini LLM secrets and the User's `CHAT_GLOBAL_DAILY_CAP=2000` in Key Vault wired through the
Container App, and provisioned real Cloudflare Turnstile (site key into the frontend build secrets,
secret key into Supabase Auth's CAPTCHA setting) — every real-credential step was User-driven and
verified (health checks, introspection). Task 3.2 then pushed `main` (31 commits) to trigger the actual
production deploy, hit and fixed one real prod-only CI failure (an untyped Vitest mock that passed tests
but failed the build's `tsc -b` type-check — now a standing Rule in `CLAUDE.md`), and walked the entire
live definition-of-done with the User on the real production site: incremental SSE streaming through
Container Apps ingress, genuine real-key Turnstile enforcement (confirmed not the test key), chat CRUD +
analytics + inline visuals, onboarding with honest stubs, the currency toggle, `manage_url`, the real
chat caps surviving redeploy, and RLS verified at the policy level in prod. **Session 3 is live in
production**, with no outstanding issues.

**Task Logs:**
- task-03-01.log.md
- task-03-02.log.md
