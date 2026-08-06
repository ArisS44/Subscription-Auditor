# APM Sessions Breakdown — SaaS Subscription Auditor

> **Purpose**: A high-level outline of how this project naturally splits into APM sessions. Use this as input to the Planner Agent at the start of each session — the Planner does the detailed Task breakdown within each session.
>
> **Principle**: Each session = one cohesive, deployable slice. Archive between sessions so the next Planner has clean context.

---

## Session 1 — Foundation & Deployment Pipeline

**Goal**: Working "Hello World" deployed to Azure with auth, before any real features. Solves deployment anxiety up front.

**Scope:**
- Monorepo scaffolding (`frontend/`, `backend/`, `extension/`, `infra/`, `.github/`)
- Local Docker Compose setup
- Backend skeleton: FastAPI + Uvicorn + health check + Supabase JWT verification middleware
- Frontend skeleton: React + Vite + TypeScript + Tailwind + shadcn/ui + dark mode + routing shell
- Supabase project creation (dev + prod)
- Database schema migration (all tables from spec §5)
- RLS policies on all user-scoped tables
- Supabase Auth wiring on frontend (email/password + Google OAuth + password reset)
- Protected route guard
- Azure resource provisioning (Container Apps, ACR, Static Web Apps, Key Vault, App Insights)
- GitHub Actions: backend → Docker → ACR → Container App, frontend → Static Web Apps
- First end-to-end deploy: log in, see a "Hello, {user}" page in production

**Done when**: a user can sign up, log in (email or Google), and see their email rendered on a protected page in production.

---

## Session 2 — Subscription CRUD & Dashboard Core

**Goal**: Fully usable subscription tracker — even without AI.

**Scope:**
- Backend: `/subscriptions` endpoints (list, create, get, update, delete, cancel)
- Backend: basic analytics endpoint (totals, top expenses, upcoming renewals)
- Frontend: dashboard shell with all tabs (Overview, Subscriptions, Detail, Reports, Chat, Settings) — only Overview/Subscriptions/Detail/Settings functional this session
- Frontend: Overview tab (monthly burn, annualized projection, upcoming renewals, top expenses, basic spend-by-category chart with Recharts)
- Frontend: Subscription list view (sortable, filterable, status indicators)
- Frontend: Subscription detail view (basic info, edit/cancel/delete actions, placeholders for usage charts)
- Frontend: manual add/edit forms (react-hook-form + zod)
- Frontend: settings page skeleton (profile, language preference, notification prefs UI — wiring comes later)
- i18n setup (en + el) with all UI strings keyed

**Done when**: user can manually manage all their subscriptions through forms, see overview stats, navigate to any subscription's detail page.

---

## Session 3 — AI Chatbot & Onboarding

**Goal**: The flagship feature. Conversational subscription management with streaming responses and inline visuals.

**Scope:**
- Backend: Groq client wrapper with native function calling
- Backend: tool definitions (`add_subscription`, `update_subscription`, `mark_cancelled`, `delete_subscription`, `query_subscriptions`, `get_analytics`, `render_chart`, `render_table`, `get_user_settings`, `update_user_settings`)
- Backend: SSE-streaming chat endpoint
- Backend: conversation + message persistence
- Backend: auto-title generation for conversations
- Backend: system prompt (bilingual, on-topic discipline, tool guidance)
- Backend: rate limiting on chat endpoint
- Frontend: chat tab UI (message list, input, send, streaming display)
- Frontend: conversation history sidebar (list, switch, delete, new)
- Frontend: inline chart and table rendering inside chat messages (reuse Recharts components)
- Frontend: onboarding flow (welcome → choose method → chat-based or manual or skip → install extension prompt → notifications prompt → done)
- Onboarding mode: chat with a modified system prompt for guiding new users

**Done when**: user can chat with the assistant, perform CRUD via natural language, ask analytics questions, see charts in chat, complete the onboarding flow.

---

> **⚠️ Roadmap revised 2026-07-22 (before Session 4 started).** Sessions 4–6 were resequenced:
> notifications moved *up* into Session 4, and everything depending on usage data moved *down* behind the
> browser extension. Sessions 1–3 below are unchanged and describe work already shipped. See
> `docs/DECISIONS.md` (2026-07-22) for the full rationale.

## Session 4 — Reminders & Guidance

**Goal**: The app starts reaching *out* to the user, and the assistant learns to advise on cancelling.
This is the first session where the backend does work nobody requested — scheduled, user-less jobs.

**Scope:**
- Frontend: fix the first-login onboarding defect (new users see the dashboard load before the wizard
  appears, and the wizard re-opens once after completion) — early, self-contained slice
- **Scheduler (the previously-deferred single-owner question, resolved):** GitHub Actions cron pings a
  token-protected `/jobs/run-due` endpoint. No APScheduler, no leader election, `minReplicas: 0`
  preserved. A delivery-ledger table with a uniqueness constraint makes double-pings idempotent
- Backend: VAPID key generation + Key Vault storage
- Backend: `push_subscriptions` table (+ RLS + cross-user isolation test), `/push/subscribe` endpoints
- Backend: push notification sender (`pywebpush`)
- Backend: renewal reminder job — per-user `renewal_lead_days` **plus** an optional per-subscription
  lead-time override (a 3-day warning on an annual renewal is nearly useless)
- Backend: least-privilege boundary for user-less scheduled work (service-role access scoped tightly —
  every other endpoint to date runs under a user's JWT with RLS)
- Frontend: service worker for receiving push + showing notifications; permission opt-in UI
- Frontend: notification preferences wired up in Settings (the switches currently render *disabled*)
- Backend: seed `service_guides` table with ~15–20 curated services (Netflix, Spotify, ChatGPT, Claude,
  Gemini, Perplexity, GitHub Copilot, Cursor, Disney+, Apple Music, YouTube Premium, Notion, Dropbox,
  iCloud, Google One, etc.) — global reference data, authenticated-read RLS
- Backend: `get_subscription_guide` tool with hybrid lookup (curated DB → LLM fallback). Curated URLs
  render as links; LLM-sourced URLs are untrusted model output and must not be linkified
- Backend: Apollon prompt tuned to permit data-grounded cancellation guidance

**Done when**: a real push reminder arrives on a real device ahead of a renewal, respecting both the
per-user and per-subscription lead time; the chatbot can answer "how do I cancel Netflix" from curated
data; the onboarding defect is gone.

---

## Session 5 — Reports & Invoice Import

**Goal**: Persisted monthly insight, and bulk subscription entry.

**Carried over from Session 4 — take these first.** Three beta-readiness Tasks were deferred at the
close of Session 4 when the session pivoted to preparing the repository for publication. All three
are small, independent, and were Ready (un-dispatched) at deferral:

- **Chat link provenance** (Frontend) — model-generated URLs currently render as clickable links in
  chat, violating the project's link-provenance rule. Confirmed live: an uncurated guidance answer
  rendered `duolingo.com` as a working link. Cause is in `frontend/src/features/chat/Markdown.tsx`
  — `marked` runs with `gfm: true` (autolinks bare domains) and `'a'`/`href` are allowlisted in
  DOMPurify. Recommended fix is to disable GFM autolinking and drop `'a'` from the allowlist, so all
  chat URLs become plain text; the curated link loses clickability, which fails safe. The
  alternative (origin allowlist preserving curated links) carries a synchronisation burden against
  the `service_guides` seed. Present the choice before implementing.
- **Require a category on manually-added subscriptions** (Frontend) — a beta user's Netflix arrived
  uncategorised. Not a defect: `subscription-schema.ts` defines `NO_CATEGORY = ''` as a sentinel that
  `toCreateInput` maps to `null`, and the select simply defaults to nothing. Tighten the manual form
  only; the chat path must still be able to leave `NULL` for a genuinely unrecognisable service.
  Watch the edit path — existing rows hold `NULL`.
- **Always-on replica & spend protection** (Infrastructure) — decide whether to set
  `--min-replicas 1`. The subscription reads `PayAsYouGo` with `spendingLimit: Off`, so credit
  exhaustion reaches a payment method with nothing to halt it. Azure Budgets alert but do not cap.
  Establish how often the app actually scales to zero before spending to prevent it; the honest
  outcome may be "no change needed", since cold starts are already accepted for a friends-only beta.

**Scope:**
- Backend: monthly report generator service (spend summary, top expense, upcoming renewals, trends,
  AI-generated recommendations) — reuses Session 2's analytics service; **per-currency, never blended**
- Backend: `/reports` endpoints (list, get by month, generate on demand)
- Frontend: Reports & Insights tab (archive list, view single report, "generate now" button) — replaces
  the current `ComingSoonPage` placeholder
- Frontend: graceful "early user" messaging when insights data is thin
- Backend: monthly review notification on the 1st — reuses Session 4's push + scheduler infrastructure,
  and now has a real report to point at (this is why it moved here from Session 4)
- Frontend: `monthly_review_enabled` toggle wired up; Monthly Review landing page (form for
  non-trackable usage logging + AI insights below)
- Backend: invoice upload endpoint (PDF / .eml / pasted text)
- Backend: PDF extraction (`pdfplumber`) with OCR fallback (`pytesseract`)
- Backend: LLM-driven subscription extraction from extracted text (untrusted input — prompt-injection
  hardening applies with full force)
- Backend: candidates confirmation endpoint
- Frontend: invoice upload UI in onboarding and standalone (Settings → "Import from invoice")
- Frontend: candidates review screen (accept/edit/reject each, bulk create on confirm)

**Done when**: a monthly report can be generated, viewed, and browsed by month; the monthly review
notification arrives on the 1st and opens that report; a PDF can be uploaded and subscriptions extracted.

---

## Session 6 — Browser Extension & Usage Intelligence

**Goal**: Silent time tracking — and the features that were blocked on having usage data at all.

**Scope:**
- Extension scaffolding (Manifest V3, Vite, TypeScript)
- Service worker with active-tab + focus tracking
- Domain matching against the tracked domain list (**note:** the User has broadened this beyond
  AI-tools-only — track as many subscriptions as a browser can actually observe; reconcile with
  `docs/APP_DESCRIPTION.md` before this session starts)
- Batched, idempotent event sending to backend
- Backend: `/extension/tokens` endpoints (issue, list, revoke) — hashed tokens, constant-time compare
- Backend: `/extension/usage` endpoint (batch ingest, uses extension token)
- Backend: subscription matching logic (link incoming domain → user's subscriptions)
- Backend: cost-per-hour computation from usage data
- **Moved here from the original Session 4** — all of it was blocked on usage data:
  - Backend: `get_recommendation` tool ("should I keep X?") — now able to reason from real usage, not
    price alone
  - Frontend: budget alert threshold UI (`cost_per_hour_target` per subscription) — a threshold on a
    metric that now exists
  - Frontend: per-subscription detail view — real usage chart, heatmap, and cost-per-hour replacing the
    three placeholder cards
- Frontend: extension management section in settings (issue token, list devices, revoke)
- Frontend: pairing flow (display token, instructions to paste into extension)
- Extension build pipeline (GitHub Actions artifact, manual Web Store submission)

**Done when**: extension installed, paired, tracking usage; cost-per-hour and the heatmap render real
data on subscription detail pages; the chatbot can answer "should I keep X?" from actual usage.

---

## Session 7 — Polish & Production Hardening

**Goal**: Make it real. Bug fixes, edge cases, observability, security.

**Scope:**
- Application Insights wiring (structured logs, traces, key events)
- **Custom domain**: purchase a domain and map it to the Static Web App (frontend) and, if desired, the Container App (backend) as custom domains + DNS + managed TLS; update Supabase Auth Site URL / redirect allowlist and backend `CORS_ALLOW_ORIGINS` to the real domain
- **Production auth email (custom SMTP)**: wire Supabase Auth to a custom SMTP provider (e.g. Resend/SendGrid) with a verified sending domain (depends on the custom domain above), replacing Supabase's rate-limited default email service so signup-verification and password-reset emails are reliable at real user volume — *deferred here from Session 1, where the default service's rate limit was hit during testing*
- Security review (RLS policies audited, JWT verification audited, secrets in Key Vault confirmed, rate limits sane)
- Edge cases (no subscriptions, no usage data, LLM errors, network failures)
- Empty states and loading states across all UI
- Mobile responsiveness pass
- Performance pass (query optimization, lazy loading, chart memoization)
- Legal disclaimer surfaces (onboarding + settings)
- Data export feature (download all user data as JSON)
- Account deletion flow
- Light mode polish (if not yet done)
- README + screenshots for the GitHub repo

**Done when**: the app feels finished — no obvious bugs, no broken empty states, all touchpoints reviewed.

---

## Session Sizing Guidance for Each Planner

When initiating a session's Planner, share:

1. The full project spec (`SPEC.md`)
2. This file (`APM_SESSIONS.md`)
3. The specific session number being worked on
4. Reference to `.apm/archives/` for completed sessions

Example Planner kickoff:

```
We're starting Session 3 of the SaaS Subscription Auditor project.
Full spec: @SPEC.md
Session plan: @APM_SESSIONS.md
This session scope: Session 3 — AI Chatbot & Onboarding.
Previous sessions (1 and 2) are archived in .apm/archives/.
```

The Planner should produce its own detailed Spec/Plan/Rules **scoped to that session only**, not the whole project.
