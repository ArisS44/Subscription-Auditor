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

## Session 4 — Guidance, Insights & Reports

**Goal**: The "intelligent" half of the assistant — guidance lookups, recommendations, and monthly reports.

**Scope:**
- Backend: seed `service_guides` table with ~15–20 curated services (Netflix, Spotify, ChatGPT, Claude, Gemini, Perplexity, GitHub Copilot, Cursor, Disney+, Apple Music, YouTube Premium, Notion, Dropbox, iCloud, Google One, etc.)
- Backend: `get_subscription_guide` tool with hybrid lookup (curated DB → LLM fallback)
- Backend: `get_recommendation` tool (analyzes usage data and price)
- Backend: monthly report generator service (spend summary, AI-tool insights from extension data placeholder, streaming/other insights, AI-generated recommendations)
- Backend: `/reports` endpoints (list, get by month, generate on demand)
- Frontend: Reports & Insights tab (archive list, view single report, "generate now" button)
- Frontend: graceful "early user" messaging when insights data is thin
- Frontend: per-subscription detail view enhancements (usage heatmap placeholder, cost-per-hour calc, renewal history)
- Frontend: budget alert threshold UI (set `cost_per_hour_target` per subscription)

**Done when**: chatbot can answer "how do I cancel X" and "should I keep X", monthly report can be generated and viewed, reports archive works.

---

## Session 5 — Notifications & Invoice Import

**Goal**: Cross-device touchpoints and bulk subscription entry.

**Scope:**
- Backend: VAPID key generation + storage
- Backend: `/push/subscribe` endpoints
- Backend: push notification sender (`pywebpush`)
- Backend: scheduled jobs via APScheduler for renewal reminders (daily check) and monthly review (1st of month)
- Frontend: service worker for receiving push + showing notifications
- Frontend: permission request UI
- Frontend: notification preferences (lead time slider, monthly review toggle) wired up in settings
- Frontend: Monthly Review landing page (form for non-trackable usage logging + AI insights below)
- Backend: invoice upload endpoint (PDF / .eml / pasted text)
- Backend: PDF extraction (`pdfplumber`) with OCR fallback (`pytesseract`)
- Backend: LLM-driven subscription extraction from extracted text
- Backend: candidates confirmation endpoint
- Frontend: invoice upload UI in onboarding and standalone (Settings → "Import from invoice")
- Frontend: candidates review screen (accept/edit/reject each, bulk create on confirm)

**Done when**: user gets renewal reminders 3 days before, gets a monthly review notification on the 1st, can upload a PDF and have subscriptions extracted.

---

## Session 6 — Browser Extension

**Goal**: Silent time tracking for AI tools.

**Scope:**
- Extension scaffolding (Manifest V3, Vite, TypeScript)
- Service worker with active-tab + focus tracking
- Domain matching against tracked AI tool list
- Batched event sending to backend
- Backend: `/extension/tokens` endpoints (issue, list, revoke)
- Backend: `/extension/usage` endpoint (batch ingest, uses extension token)
- Backend: subscription matching logic (link incoming domain → user's subscriptions)
- Backend: cost-per-hour computation from usage data
- Frontend: extension management section in settings (issue token, list devices, revoke)
- Frontend: pairing flow (display token, instructions to paste into extension)
- Frontend: per-subscription detail view — real usage data + heatmap rendered
- Extension build pipeline (GitHub Actions artifact, manual Web Store submission)

**Done when**: extension installed, paired, tracking AI tool usage; cost-per-hour appears on subscription detail pages.

---

## Session 7 — Polish & Production Hardening

**Goal**: Make it real. Bug fixes, edge cases, observability, security.

**Scope:**
- Application Insights wiring (structured logs, traces, key events)
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
