---
title: SaaS Subscription Auditor — Session 3: AI Chatbot & Onboarding
modified: Added "Overview Roadmap Teaser" (a playful future-updates message on the Overview) as a scope addition per direct User request during Stage 2. Modified by the Manager.
---

# APM Spec

## Overview

Session 3 builds the flagship feature of the SaaS Subscription Auditor: **Apollon**, a bilingual (EN/EL),
streaming AI chatbot that manages subscriptions through natural language, plus a guided onboarding flow.
It layers a single-agent, tool-calling chat engine onto the existing Session-2 subscription CRUD +
analytics services (which it reuses, so per-user RLS isolation is inherited, not re-implemented), persists
conversations, renders charts/tables inline in chat, and ships the security and cost controls a live
LLM-backed surface requires. It also folds in two self-contained slices: an optional per-subscription
manage/cancel link, and opt-in live currency conversion on the Overview. **Done when:** a user can chat
with Apollon to add/edit/cancel/delete subscriptions and ask analytics questions, see charts in chat,
complete the onboarding flow, and all of it is rate-limited, cost-capped, CAPTCHA-guarded at signup, and
XSS-safe — deployable to production.

## Workspace

Single Git monorepo, `main` is the deployable branch (pushing to `origin/main` triggers the production
deploy workflows). Working targets:

- `backend/` — FastAPI (Python 3.11), strict `routers/ → services/ → db/` layering. Key existing
  patterns the chat engine builds on: `app/deps.py::get_current_claims` (Supabase JWT verification via
  JWKS, returns claims with `sub` = user_id); `app/db/rls.py::rls_connection(claims)` (RLS-scoped
  asyncpg connection); `app/services/{subscription,analytics,profile}.py` (the services tools reuse);
  `app/config.py` (pydantic-settings; already has an unused `groq_api_key`); `app/middleware/rate_limit.py`
  (in-memory per-IP limiter); `app/main.py` (router + middleware wiring).
- `frontend/` — React 18 + Vite + TypeScript, Tailwind, shadcn/ui (Base UI `base-nova` preset),
  Recharts, react-i18next (`src/i18n/`, `en`/`el`), TanStack Query, React Router v7. Key existing
  patterns: `src/lib/api.ts::apiFetch` (plain `fetch` wrapper injecting the bearer token);
  `src/hooks/useSubscriptions.ts` (TanStack Query hook pattern); `src/features/analytics/CategorySpendChart.tsx`
  (dark-mode-validated Recharts component to reuse in chat); `src/features/dashboard/pages/ComingSoonPage.tsx`
  (the current Chat placeholder route to replace); `src/routes/auth/*` (signup/login/reset forms that
  gain CAPTCHA).
- `supabase/migrations/` — versioned SQL migrations applied to **dev first, then prod**. The Supabase
  CLI is currently linked to **prod** (`ylwjevannrlsauegwbas`); it must be relinked to dev
  (`zocfhyysnvptxktqezfk`) before any dev migration.

Authoritative source documents (reference, do not restate): `docs/APP_DESCRIPTION.md` (full spec — §2.1
chatbot, §2.9 onboarding, §3.3 tool-calling pattern, §5 schema, §6 API surface), `docs/APM_SESSIONS.md`
(Session 3 scope), `docs/ENGINEERING_STANDARDS.md` (four pillars — MUST comply), `docs/DECISIONS.md`
(the two 2026-07-09 entries are the primary design inputs for this session; also the 2026-07-08 currency
entry). Session 1 & 2 archives at `.apm/archives/`.

---

> **Notes:** The Supabase CLI is linked to **prod** — the first migration Task must relink to dev
> (`supabase link --project-ref zocfhyysnvptxktqezfk`) before pushing, and prod application is a
> User-driven step (real credentials). `GROQ_API_KEY` is not yet in any `.env`/Key Vault — provisioning
> it is a User coordination step the first backend Task depends on. Enabling CAPTCHA in the Supabase
> dashboard + obtaining Turnstile keys is likewise a User coordination step. Full-suite pytest
> intermittently fails 1–3 live-DB tests due to Supabase free-tier Auth Admin API rate limiting under
> back-to-back test users — known flakiness, not a regression, if the same test passes on isolated rerun.
> The two 2026-07-09 decisions in `docs/DECISIONS.md` are load-bearing inputs; a design change should
> update them. SSE must not be buffered by Container Apps ingress (`Cache-Control: no-cache`,
> `X-Accel-Buffering: no`); verify incremental delivery after deploy.

## Assistant Identity & Behavior

- **Name:** Apollon (Απόλλων) — baked into the system prompt and surfaced in i18n-keyed UI copy (`en`/`el`).
- **Tone:** neutral & concise — professional, clear, no filler.
- **Bilingual:** per-message language auto-detection (respond in the language of the user's last message);
  honors `profiles.preferred_language` when it is `en`/`el` rather than `auto`. Tool descriptions/params
  stay in English (LLM internals); UI static text via i18n.
- **On-topic discipline:** refuses off-topic input and generalized financial advice; surfaces the legal
  disclaimer (AI-generated advice is not professional financial advice).
- **Destructive-action confirmation:** `delete_subscription` AND `mark_subscription_cancelled` require an
  explicit in-chat user confirmation before the tool executes (the model asks, and only calls the tool
  after a clear yes). Add/edit/query/settings tools execute directly.

## Chat Engine & LLM Integration

The chatbot is **one LLM with a defined tool set** (single-agent tool-calling per `docs/APP_DESCRIPTION.md`
§3.3) — **not** MCP, not multi-agent, no LangChain. Each user message produces 0–N tool calls and one
final natural-language response, streamed to the client.

**Provider-agnostic LLM layer (multi-LLM-ready — see `docs/DECISIONS.md` 2026-07-09 "LLM layer").** All
model access goes through one `backend/app/services/llm.py` wrapper exposing a small interface (stream a
chat turn given messages + tool definitions; also a one-shot completion for title generation). The chat
router, tool loop, and frontend are provider-blind. Provider, model, and key come from **environment
only** (`LLM_PROVIDER`, `LLM_MODEL`, `LLM_API_KEY` — reuse the existing `groq_api_key` setting for the
Groq default), never hardcoded.

- **Default:** Groq, `llama-3.3-70b-versatile`. **Documented swap:** Claude Haiku 4.5 (config change only).
- **The adapter isolates all provider differences:** (a) tool-definition envelope (`function.parameters`
  vs `input_schema` — same inner JSON Schema), (b) how tool results re-enter history (OpenAI `role:"tool"`
  + `tool_call_id` vs Anthropic `tool_result` block + `tool_use_id`), (c) normalizing provider SSE chunks
  into one internal event stream.
- **One neutral tool registry + one canonical bilingual system prompt.** Per-model prompt tuning is
  deferred as optional polish. Adding a tool = registering it, not editing the chat loop (standards §A).

**Tool set for Session 3** (reuse existing services with the caller's claims → RLS enforced automatically;
validate every tool-call payload with Pydantic before execution — LLM output is untrusted):

| Tool | Backing service | Notes |
|---|---|---|
| `add_subscription` | `services/subscription.py::create_subscription` | Accepts optional `manage_url` (see Data Model). |
| `update_subscription` | `services/subscription.py::update_subscription` | Partial update. |
| `mark_subscription_cancelled` | `services/subscription.py::cancel_subscription` | Requires in-chat confirmation. |
| `delete_subscription` | `services/subscription.py::delete_subscription` | Requires in-chat confirmation. |
| `query_subscriptions` | `services/subscription.py::list_subscriptions` | Filters/sort/limit. |
| `get_analytics` | `services/analytics.py` | Returns real per-currency roll-ups (the source for inline charts). |
| `get_user_settings` | `services/profile.py` | |
| `update_user_settings` | `services/profile.py` (`PATCH /me` path) | e.g. language, prefs. |
| `render_chart` | none (presentation) | Packages analytics-tool data into a validated chart payload. |
| `render_table` | none (presentation) | Packages tabular data into a validated table payload. |

**Deferred to Session 4** (do NOT build here): `get_subscription_guide`, `get_recommendation`, and the
curated `service_guides` table.

**Conversation loop & context:** cap tool iterations per turn at ~5 to prevent runaway loops; replay a
**sliding window of ~20 messages** (standards / spec §12.6) to bound token cost; **auto-generate a
conversation title** from the first user message via a short second LLM call through the same provider.
Log per-call token usage (no PII / message content in logs).

**Inline visuals are grounded in real data, never invented by the LLM.** Chart/table content originates
from `get_analytics` results; `render_chart`/`render_table` payloads are **schema-validated server-side**
before persistence/streaming (chart_type from a fixed enum; numeric series; string labels length-capped
and sanitized). This is both a correctness rule (no hallucinated numbers) and an XSS control (see Security).

## Data Model & Persistence

New Supabase migrations (dev then prod; RLS on every user-scoped table with the established
`auth.uid() = user_id` pattern; a real-DB cross-user RLS-denial test is required for each new user-scoped
table, per `CLAUDE.md`). Schemas per `docs/APP_DESCRIPTION.md` §5 unless noted.

- **`conversations`** — `id`, `user_id` (FK, RLS), `title` (auto-generated), timestamps. Retention: kept
  until the user deletes; deletion cascades to `messages` (GDPR-aligned).
- **`messages`** — `id`, `conversation_id` (FK), `user_id` (FK, RLS), `role`
  (`user|assistant|tool|system`), `content`, `tool_calls` JSONB, `tool_call_id`, `structured_payload`
  JSONB (validated inline chart/table payloads), `created_at`. Index on `(conversation_id, created_at)`.
- **`subscriptions.manage_url`** (new column) — optional, user-provided provider manage/cancel URL.
  Nullable TEXT, validated at the API boundary (well-formed `http(s)` URL, length-capped). **Option A**
  per `docs/DECISIONS.md`: user-provided only; curated auto-fill + LLM discovery is Session 4. Add to
  `SubscriptionCreate/Update/Response` (backend) and the frontend `Subscription` types/forms.
- **`fx_rates`** — global reference data (not user-scoped): base/quote/rate + `fetched_at`. RLS enabled,
  authenticated-read only (like `service_guides`); the backend refreshes it via the service role.
- **`llm_usage`** (or equivalent daily-counter design) — **DB-backed** per-user and app-wide daily
  request/token counters. DB-backed (not in-memory) so the daily caps are correct across replicas and
  survive restarts (the in-memory limiter is fine only for per-request velocity, not daily budgets).

## Security & Cost Controls (chat ships fully secured)

Implements `docs/ENGINEERING_STANDARDS.md` §B and the `docs/DECISIONS.md` 2026-07-09 "LLM layer" defenses.
A live user-facing LLM surface must not ship half-secured (`docs/DECISIONS.md` 2026-07-01).

- **Rate limiting (tiered):** per-user chat velocity limit **30/min**, enforced **post-auth, keyed by
  user_id** (the existing middleware is per-IP and pre-auth; chat velocity belongs in the chat
  router/service where the user_id is known). Per-IP auth limits stay in middleware.
- **Cost caps:** a **per-user daily cap of 200 messages/day** AND an **app-wide global daily ceiling**
  (a tunable config value, default generous ~5,000 requests/day — high enough to never bother real use,
  low enough to bound a runaway; the global one is what actually bounds a Sybil / mass-account attack, as
  per-user caps alone don't). Both DB-backed (see Data Model). On breach: graceful degradation
  ("assistant is busy / daily limit reached, try later"), never an unbounded bill or crash. On the free
  tier the worst case is availability, not spend — the global cap makes going paid safe later.
- **CAPTCHA on signup (built this session):** **Cloudflare Turnstile** via Supabase Auth. Note: Supabase's
  CAPTCHA protection is **project-wide across auth endpoints**, so the frontend **signup, login, AND
  password-reset** forms must all submit a CAPTCHA token (not signup-only) — otherwise existing users'
  logins would fail. **Existing sessions are unaffected** (no re-signup, no forced logout); users only
  meet the widget on their next signup/login/reset. Obtaining Turnstile keys + enabling the dashboard
  setting is a User coordination step.
- **Prompt injection (LLM input is untrusted):** isolate user-supplied content in the prompt; **never let
  raw model output trigger a privileged action** — every tool-call payload is Pydantic-validated before
  execution; malformed calls return a clean error to the LLM to retry.
- **XSS (LLM output + stored messages are untrusted data):** **no raw HTML from the LLM or DB, ever.**
  Render markdown through **DOMPurify** with a tag allowlist; render inline charts/tables via typed React
  components (Recharts / a table component), never `dangerouslySetInnerHTML`; validated
  `structured_payload` only. Keep the strict CSP shipped in Session 1.
- **Privacy:** no PII to the LLM beyond what a feature needs; no message content or PII in logs
  (standards §C / spec §11).

## Frontend: Chat UI & Inline Visuals

The Chat tab (currently `ComingSoonPage`) becomes functional as a `features/chat` module.

- **Views:** message list, input + send, streaming assistant display; a conversation-history sidebar
  (list, switch, new, delete).
- **Streaming transport (design constraint):** consume the SSE stream with **`fetch` + a ReadableStream
  reader**, **not** `EventSource` — `EventSource` cannot send the `Authorization` bearer or POST a body,
  which the auth model requires. Conversation list/history use TanStack Query; the live stream is handled
  outside the query cache.
- **Inline visuals (broader S3 set):** a generic table + the spend-by-category chart (reuse
  `CategorySpendChart`) + a **top-expenses bar chart** + an **upcoming-renewals list/table**, rendered
  inside chat bubbles for visual consistency; markdown sanitized via DOMPurify.
- **i18n & formatting:** every user-facing string keyed in `en` + `el`; numbers/dates/currency via the
  `Intl` API keyed to the active language. Dark mode is the primary target; Base UI preset components.

## Onboarding Flow

Per `docs/APP_DESCRIPTION.md` §2.9: **welcome → choose-method → (chat | manual | skip) → install-extension
prompt → enable-notifications prompt → done**, landing on the Overview.

- **Chat-based onboarding reuses Apollon** with a different (onboarding) system prompt — do NOT build a
  separate chat component.
- **Manual** reuses the **existing Session-2 add form** (single-subscription dialog) as-is — no new
  multi-add form this session. **Upload-a-bank-statement**, **install-extension**, and
  **enable-notifications** steps are **clearly-labeled "coming soon" stubs** (invoice/push = Session 5,
  extension = Session 6).
- **Skippable at every step and resumable:** `profiles.onboarding_completed` (already in schema) tracks
  completion; a dashboard banner offers "Continue setup" when incomplete.

## Currency Conversion (opt-in slice)

Folded into Session 3 per `docs/DECISIONS.md` 2026-07-09 (supersedes the 2026-07-08 "fast-follow" timing;
design unchanged). Per-currency grouping remains the **default everywhere**; conversion is **opt-in and
labeled an estimate**, never silently blended into real figures.

- An **opt-in "convert to [currency]" control on the Overview** shows converted comparison totals /
  fairer cross-currency top-expenses. **Scope for S3 is the Overview control only** — the chat (Apollon)
  keeps answering analytics in native per-currency this session; in-chat conversion is out of scope.
- Backed by a **lazy-refresh FX cache with a ~12h staleness TTL** against a free, no-key source
  (Frankfurter / ECB): the first request after the TTL expires triggers a refresh, then reads serve from
  `fx_rates`. **No APScheduler** — deliberately avoids the unresolved scheduler single-owner question
  (deferred to Session 5); user-visible accuracy equals "refresh a couple times a day."

## Overview Roadmap Teaser (fun addition)

A small, light-hearted, non-modal message on the Overview mentioning upcoming features (e.g. invoice
import, the browser extension, push reminders — the Session 4-7 roadmap) so returning users have
something to look forward to. Tone is playful/informal, distinct from the rest of the app's neutral
tone — this is the one spot allowed to have personality. Not a banner-of-shame empty state, not a
recurring popup/modal, not dismissable-with-tracking (no non-essential tracking exists in this app —
keep it that way); a small static or lightly-rotating text element is enough. Exact copy and placement
are a UX-collaboration decision with the User (per this project's visual/aesthetic convention), not
fixed by this Spec. `en`/`el` keyed like every other user-facing string.

## API Surface Additions

All under `/api/v1`, Bearer-JWT auth (never cookies), Pydantic-validated. Per `docs/APP_DESCRIPTION.md` §6.4:

- `GET /conversations`, `POST /conversations`, `GET /conversations/{id}/messages`,
  `POST /conversations/{id}/messages` → **SSE stream**, `DELETE /conversations/{id}`.
- `manage_url` added to the existing subscription create/update/response shapes.
- FX endpoint(s) exposing rates / converted totals for the Overview control.
- Reuses existing `GET/PATCH /me` for the settings tools.
