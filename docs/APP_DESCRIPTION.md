# SaaS Subscription Auditor — Project Specification

> **Document purpose**: This is the complete technical specification of the project, intended as context for an Agentic Project Management (APM) tool that will generate the implementation plan. It describes **what** to build and **how it is architected** — it does not prescribe build order, phases, or timelines.

---

## 1. Project Summary

**SaaS Subscription Auditor** is a full-stack, AI-native web application that helps users track, analyze, and optimize their recurring subscriptions (SaaS tools, streaming services, AI tools, etc.). It combines:

- A **conversational AI assistant** that handles subscription management through natural language (bilingual: English + Greek).
- **Automatic usage tracking** for browser-based AI tools via a Chromium extension.
- **Manual usage reporting** for non-trackable subscriptions (streaming, etc.) via a monthly notification cycle.
- **AI-powered insights and optimization advice** based on usage and cost data.
- A **beautiful dark-mode dashboard** with interactive charts.

### Positioning

The app's unique angle is being **AI-native and AI-tool-aware** — it does not depend on bank-linking (Plaid-style integrations), and instead emphasizes:
- Conversational, multilingual UX.
- Privacy (no bank credentials, manual + invoice-upload data input).
- First-class tracking of AI tool subscriptions (Claude, ChatGPT, Gemini, Perplexity, GitHub Copilot, Cursor, etc.) with cost-per-hour analytics.

### Project context

- **Solo developer**, primarily AI-assisted (Claude Opus / Claude Code).
- Goal: **portfolio piece + personal learning + actual personal use** (the developer will use it themselves).
- **All features ("v2") are in scope** — no MVP cuts.
- Hosted on **Azure** using the developer's $100 Azure Student credits, supplemented by free tiers (Supabase, Groq).

---

## 2. Core Features (Functional Pillars)

The app has **nine functional pillars**. All are in scope.

### 2.1 AI Assistant Chatbot

A conversational interface that is the primary way users interact with the app (alongside the dashboard).

**Capabilities:**
- **Bilingual**: English and Greek. Language is auto-detected from the user's input on a per-message basis.
- **On-topic only**: Politely refuses anything unrelated to subscriptions, spending, or app functionality.
- **No fixed name** (TBD; can be configured later).
- **Full CRUD on subscriptions** via natural language:
  - Add ("I subscribed to Claude Pro for $20 on the 5th")
  - Edit ("Change my Netflix plan to $15.99")
  - Mark as cancelled ("I cancelled Spotify")
  - Delete ("Remove that ChatGPT entry")
- **Queries and analytics**:
  - "How much am I spending on AI tools this month?"
  - "Which subscription costs me the most per hour?"
  - "Show me last month's total."
- **Inline visual responses**: The chatbot can render charts, tables, and stats *inline in chat messages* (not only in the dashboard). The backend returns structured data; the frontend chat UI renders it via Recharts/HTML tables.
- **Subscription guidance** (hybrid knowledge source):
  - **Curated DB** of top services (verified cancel URLs, signup steps, plan info) for common services (Netflix, Spotify, ChatGPT, Claude, etc.).
  - **LLM fallback** for services not in the curated DB.
- **Recommendations on demand**: "Should I keep my ChatGPT subscription?" → analyzes usage data and gives a concrete answer.
- **Drives the onboarding flow** (see §2.9). The same chatbot, with a slightly different system prompt, walks new users through adding their initial subscriptions.

**Out of scope for the chatbot:**
- Does **not** actually cancel subscriptions on third-party sites (only marks them as cancelled in the user's DB when the user confirms).
- Does **not** discuss off-topic subjects (politics, general LLM chat, etc.).
- Does **not** give generalized financial advice beyond subscription optimization (a legal disclaimer is shown to the user).

### 2.2 Manual Entry & Management

Classic, click-based UI for users who prefer forms over chat.

- Add / edit / delete subscriptions via standard forms.
- Sortable, filterable list view of all subscriptions.
- Bulk operations (optional).
- All CRUD operations available here must also be available via the chatbot, and vice versa — they are two interfaces to the same data.

### 2.3 Bank Invoice Import (Manual Upload)

Users can extract subscriptions from financial documents.

- **Manual upload only** — the user uploads a PDF or pastes the text/HTML of a bank email/statement. No Gmail API, no Plaid, no inbound email forwarding (those are explicitly out of scope).
- File types: **PDF**, **.eml** (email file), pasted text.
- Backend pipeline:
  1. Extract text from PDF (using `pdfplumber`; fall back to `pytesseract` OCR if PDF is image-based).
  2. Pass extracted text to the LLM with a structured extraction prompt.
  3. LLM returns a JSON list of candidate subscriptions (name, amount, currency, frequency, charge date).
  4. Display candidates to the user for confirmation / editing before persistence.
- Uploaded files are stored in Supabase Storage with user-scoped access.

### 2.4 Browser Extension (Chrome / Chromium)

A lightweight extension that **silently tracks time-on-site** for a curated list of AI tool domains.

**Scope (v1 of extension):**
- Manifest V3.
- Tracks the following domains by default (configurable list):
  - `chat.openai.com`, `chatgpt.com` (ChatGPT)
  - `claude.ai` (Claude)
  - `gemini.google.com` (Gemini)
  - `perplexity.ai`
  - `github.com/copilot`, `copilot.github.com` (GitHub Copilot Web)
  - `cursor.com`, `cursor.sh` (Cursor Web)
- Records **active time** (foreground tab + window focused) per domain.
- Sends usage events to the backend in batches (e.g., every 5 minutes or on tab close).
- **No UI** in v1 — operates silently in the background. (A popup may be added later.)
- **Auth via token sync**: User logs into the web app, the web app generates an extension-pairing token, the user pastes it (or it auto-syncs) into the extension. The extension then includes a long-lived bearer token in every API call. No separate login.
- The extension does **not** handle notifications (that's Web Push from the backend).

**Explicitly out of scope for the extension:**
- Renewal reminders (handled via Web Push).
- Monthly usage reminders (handled via Web Push).
- Tracking non-AI sites (Netflix, Spotify, etc. — they use cross-device players, so the user reports manually).

### 2.5 Web Push Notifications

All notifications use the **Web Push API + VAPID** so they work cross-browser (Chrome, Firefox, Safari, Edge, mobile).

**Notification types:**
1. **Renewal reminders** — sent before a subscription renews.
   - **Default lead time: 3 days before renewal.**
   - **User-configurable** per user (and optionally per subscription).
   - One notification per renewing subscription.
2. **Monthly review prompt** — a single consolidated notification, once per month, that:
   - Prompts the user to log usage for non-trackable subscriptions (streaming, etc.).
   - Surfaces the **AI-generated monthly insights** (see §2.6).
   - Clicking the notification opens a dedicated "Monthly Review" page in the web app.

**No "Sunday Audit" / weekly notifications** — monthly cadence aligns with monthly billing cycles and avoids notification fatigue.

**Implementation:**
- Backend uses `pywebpush` to send notifications.
- Frontend registers a service worker, requests notification permission, and stores the push subscription endpoint in the backend.
- A scheduled job (APScheduler) checks daily for upcoming renewals (within user's lead-time window) and the 1st of each month for monthly reviews.

### 2.6 Smart Recommendations & Insights

The AI generates insights at two levels:

**On-demand (via chatbot):**
- The user asks the chatbot for analysis ("Am I getting value from ChatGPT?").
- The chatbot queries live data and gives an immediate, specific answer.

**Scheduled (monthly review):**
- On the 1st of each month, the backend generates a snapshot report per user containing:
  - **Spend summary**: total spent last month, top expense, upcoming renewals.
  - **AI tool insights** (rich from day 1, sourced from extension data): hours per tool, cost-per-hour, underused tools.
  - **Streaming/other insights** (becomes meaningful from month 2+): month-over-month trends, drops in usage, cancellation suggestions.
  - **Recommendations**: 1–3 AI-generated bullet points based on all the above.
- Reports are persisted (so users can browse past months) and surfaced via the Reports tab + Monthly Review notification.

**Important UX principle**: The insights system **acknowledges its own data limits gracefully** for new users. Early users see fewer insights; insights grow richer as data accumulates. This is shown explicitly in the UI ("More insights will be available after we have a few months of data").

**Borrowed competitor ideas that are in scope:**
- **Budget alert thresholds** (inspired by QuotaMeter): users can set a target max cost-per-hour for a subscription; the system flags when it's exceeded.
- **Usage heatmap** (inspired by Claude Usage Tracker): GitHub-style activity grid showing usage intensity per day, displayed in the per-subscription detail view.

### 2.7 Dashboard

Persistent web dashboard, dark mode by default, built with React + Tailwind + shadcn/ui + Recharts.

**Required tabs/views:**

1. **Overview** — homepage of the app.
   - Total monthly burn (and annualized projection).
   - Top expenses (sorted list).
   - Upcoming renewals (next 30 days, calendar or list).
   - High-level charts (spend by category, trend over time).

2. **Subscription List**
   - Sortable, filterable table of all subscriptions.
   - Inline CRUD actions.
   - Status indicators (active / cancelled / paused).

3. **Subscription Detail** (per-subscription page)
   - Usage history (chart over time).
   - Cost-per-hour calculation (for tracked services).
   - Usage heatmap (GitHub-style grid).
   - Renewal history.
   - Notes / metadata.
   - Edit / cancel / delete actions.

4. **Reports & Insights**
   - Archive of past monthly reports.
   - On-demand "Generate insights now" button (also accessible via chatbot).
   - Long-form AI recommendations.

5. **Chat**
   - The full conversational AI interface (see §2.1).
   - Sidebar with chat history (see §2.8).
   - Streaming responses (SSE).
   - Inline chart/table rendering.

6. **Settings**
   - Account / profile.
   - Notification preferences (renewal lead time, monthly review on/off).
   - Connected extension status.
   - Language preference (auto-detect override).
   - Legal disclaimer & data export.

**Design language:**
- **Dark mode default** (light mode optional).
- **shadcn/ui** as the component library (copy-paste components, full ownership of styles).
- **Tailwind CSS** for utility styling.
- **Recharts** for all charts.
- **lucide-react** for icons.

### 2.8 Authentication & User Management

Auth is handled entirely by **Supabase Auth**.

**Required auth flows:**
- **Email + password** signup and login.
- **Google OAuth** ("Sign in with Google").
- **Email verification** (required on signup).
- **Password reset** flow (email-based).
- **"Remember me"** (persistent session via Supabase refresh tokens).
- **Logout** (revokes refresh token).

**Backend integration:**
- Backend (FastAPI) verifies Supabase JWTs on every protected endpoint using Supabase's JWKS.
- A FastAPI dependency extracts `user_id` from the JWT and passes it to handlers.

**Authorization:**
- All data access is scoped per-user via **Supabase Row-Level Security (RLS)** policies on every table.
- Backend uses the user's JWT when calling Supabase so RLS is enforced automatically.

### 2.9 Onboarding Flow

A guided getting-started experience shown to new users after signup.

**Flow:**
1. **Welcome screen** — brief intro, [Skip] / [Get Started].
2. **Choose entry method** — user picks how they want to add their initial subscriptions:
   - 💬 **Chat with the assistant** — opens the chatbot in onboarding mode.
   - 📝 **Add manually** — opens a multi-add form (compact, batch-friendly).
   - 📧 **Upload a bank statement** — opens the invoice-import flow.
   - ⏭️ **Skip for now**.
3. **Install browser extension prompt** (optional step) — explains what the extension does, links to install instructions.
4. **Enable notifications prompt** (optional step) — requests notification permission and registers push subscription.
5. **Done** — lands on the Overview dashboard.

**Implementation notes:**
- The chat-based onboarding **reuses the main chatbot** with a different system prompt ("You are guiding a new user through adding their first subscriptions…"). Do not build a separate chat component.
- Onboarding is **skippable at every step** and **resumable** (a banner on the dashboard offers "Continue setup" if not complete).
- A `users.onboarding_completed` boolean field tracks completion.

---

## 3. Architecture

### 3.1 High-Level Diagram

```
┌────────────────────────────────────────────────────────────────────┐
│                          USER'S BROWSER                             │
├────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌────────────────────┐         ┌────────────────────────┐         │
│  │  Web App (React)   │         │  Chrome Extension       │         │
│  │  - Dashboard       │         │  - MV3 service worker  │         │
│  │  - Chat (SSE)      │         │  - Tracks AI tool tabs │         │
│  │  - Forms           │         │  - Batched event sends │         │
│  │  - Service worker  │         │                        │         │
│  │    (Web Push)      │         │                        │         │
│  └─────────┬──────────┘         └──────────┬─────────────┘         │
│            │                                │                       │
└────────────┼────────────────────────────────┼───────────────────────┘
             │                                │
             │ HTTPS + JWT                    │ HTTPS + extension token
             │                                │
             ▼                                ▼
┌────────────────────────────────────────────────────────────────────┐
│                      AZURE (Production)                             │
├────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────────────────┐    ┌────────────────────────────┐    │
│  │  Static Web Apps        │    │  Container Apps             │    │
│  │  (React build artifact) │    │  (FastAPI + Uvicorn         │    │
│  │                         │    │   in Docker, scale-to-zero) │    │
│  └─────────────────────────┘    └─────────────┬──────────────┘    │
│                                                 │                   │
│  ┌─────────────────────────┐                   │                   │
│  │  Container Registry     │◄──────────────────┤                   │
│  │  (Docker images)        │                   │                   │
│  └─────────────────────────┘                   │                   │
│                                                 │                   │
│  ┌─────────────────────────┐                   │                   │
│  │  Application Insights   │◄──────────────────┤                   │
│  │  (Logs, metrics, traces)│                   │                   │
│  └─────────────────────────┘                   │                   │
│                                                 │                   │
│  ┌─────────────────────────┐                   │                   │
│  │  Key Vault              │◄──────────────────┤                   │
│  │  (Secrets)              │                   │                   │
│  └─────────────────────────┘                   │                   │
└─────────────────────────────────────────────────┼───────────────────┘
                                                  │
                       ┌──────────────────────────┼──────────────────────┐
                       │                          │                      │
                       ▼                          ▼                      ▼
              ┌─────────────────┐    ┌──────────────────┐    ┌──────────────────┐
              │   Supabase      │    │   Groq API       │    │  Push Services   │
              │  - PostgreSQL   │    │  (Llama 3.3 70B  │    │  (FCM, Mozilla,  │
              │  - Auth         │    │   Versatile,     │    │   Apple, etc.    │
              │  - Storage      │    │   tool calling,  │    │   — via VAPID)   │
              │  - RLS enforced │    │   streaming)     │    │                  │
              └─────────────────┘    └──────────────────┘    └──────────────────┘
```

### 3.2 Architectural Principles

- **Local-first development**: Everything runs on the developer's laptop via Docker Compose. Cloud deploy is automated via CI/CD.
- **Single agent + tool calling** (not multi-agent, no LangChain): One LLM with a well-defined set of tools/functions. Each chat turn results in 0–N tool calls and a final natural-language response.
- **Server-Sent Events (SSE)** for streaming chat responses from backend to frontend — not WebSockets, not polling.
- **Row-Level Security** is the primary authorization mechanism. The backend trusts Supabase RLS to scope data per user.
- **No premature optimization**: No microservices, no message queues, no caching layer beyond what's free/trivial. APScheduler runs in-process for scheduled jobs.
- **Scale-to-zero by default**: Azure Container Apps `minReplicas: 0` so the backend costs ~$0 when idle.
- **Secrets in Key Vault** in production; in `.env` files locally (gitignored).
- **Privacy by design**: No bank credentials, no third-party data sharing, no telemetry beyond Application Insights.

### 3.3 Single-Agent Tool Calling Pattern

The chatbot is **one LLM call with a defined tool set**, not multiple agents. The flow:

```
User message
    │
    ▼
[System prompt + conversation history + user message]
    │
    ▼
LLM (Gemini Flash-Lite, Groq/Llama 3.3 70B as fallback) — function calling enabled
    │
    ├─→ Decides to call 0, 1, or N tools
    │
    ▼
Backend executes called tools (DB queries, computations, lookups)
    │
    ▼
Tool results fed back to LLM
    │
    ▼
LLM produces final response (text + optional structured payload for inline charts)
    │
    ▼
Stream to frontend via SSE
```

**Tools the LLM can call** (initial set — extend as needed):
- `add_subscription(name, price, currency, billing_cycle, start_date, category, notes?)`
- `update_subscription(id, fields_to_update)`
- `mark_subscription_cancelled(id, cancellation_date)`
- `delete_subscription(id)`
- `query_subscriptions(filters: {category, status, sort_by, limit})`
- `get_analytics(metric, timeframe)` — e.g. metric="total_spend", timeframe="last_month"
- `get_subscription_guide(service_name)` — hybrid: curated DB → LLM fallback
- `get_recommendation(subscription_id)` — analyzes usage data, returns advice
- `render_chart(chart_type, data, title)` — returns a structured payload the frontend renders inline
- `render_table(columns, rows, title)` — same, for tabular data
- `get_user_settings()` / `update_user_settings(fields)` — for preference changes via chat

### 3.4 Multilingual Handling

- **Per-message language detection** (Greek or English) — the LLM handles this natively via the system prompt.
- The system prompt instructs the model to **respond in the same language the user used in their last message**.
- All tool descriptions and parameters remain in English (LLM internals).
- UI labels and static text use **i18n** (e.g., `react-i18next`) with `en` and `el` locales.

---

## 4. Tech Stack (Locked)

### 4.1 Frontend
| Layer | Choice |
|---|---|
| Framework | React 18 + Vite |
| Language | TypeScript |
| Styling | Tailwind CSS |
| Component library | shadcn/ui |
| Charts | Recharts |
| Icons | lucide-react |
| State (client) | Zustand (light) |
| State (server) | TanStack Query (React Query) |
| Routing | React Router v6 |
| Forms | React Hook Form + Zod |
| i18n | react-i18next |
| Auth client | `@supabase/supabase-js` |
| Streaming | Native `EventSource` API for SSE |
| HTTP | `fetch` (or `ky` if convenient) |

### 4.2 Backend
| Layer | Choice |
|---|---|
| Language | Python 3.11+ |
| Framework | FastAPI |
| ASGI server | Uvicorn |
| Validation | Pydantic v2 |
| DB driver | `asyncpg` (direct Postgres) and/or `supabase-py` |
| JWT verification | `pyjwt` + Supabase JWKS |
| LLM client | `groq` SDK (OpenAI-compatible) |
| PDF parsing | `pdfplumber` |
| OCR fallback | `pytesseract` |
| Email file parsing | `mail-parser` |
| Web Push | `pywebpush` |
| Background jobs | `APScheduler` (in-process) |
| Logging | `structlog` |
| Observability | `opencensus-ext-azure` → Application Insights |

### 4.3 Browser Extension
| Layer | Choice |
|---|---|
| Manifest | V3 |
| Language | TypeScript |
| Build | Vite (with `@crxjs/vite-plugin` or similar) |
| Storage | `chrome.storage.local` |
| Background | Service worker |

### 4.4 Infrastructure
| Service | Tier |
|---|---|
| Azure Container Apps | Consumption (scale-to-zero, minReplicas=0) |
| Azure Container Registry | Basic |
| Azure Static Web Apps | Free |
| Azure Application Insights | Free tier (5 GB/mo) |
| Azure Key Vault | Standard |
| Supabase | Free tier |
| Google Gemini | Paid Cloud Prepay (~€10, auto-reload off) |
| GitHub | Free (public or private repo) |

### 4.5 LLM Configuration
- **Provider**: Google Gemini (migrated from Groq in Session 3 — see `docs/DECISIONS.md` 2026-07-13; Groq's free tier proved too rate-limited for real multi-user testing). Groq remains a selectable fallback adapter behind the same provider-agnostic `llm.py` wrapper.
- **Model**: `gemini-flash-lite-latest` (primary — a moving alias; consider pinning to a dated model for reproducibility). `llama-3.3-70b-versatile` via Groq remains available as a documented fallback.
- **Function calling**: Native, translated behind one internal tool-definition format per provider.
- **Streaming**: Enabled for chat endpoints.

### 4.6 Cost Profile

Expected monthly burn at low traffic:

| Item | Cost |
|---|---|
| Container Apps (idle most of the time) | ~$2–5 |
| Container Registry (Basic) | ~$5 |
| Static Web Apps | $0 |
| Application Insights | $0 |
| Key Vault | ~$0.03 |
| Supabase | $0 |
| Google Gemini | ~€10 one-time prepay (hard cap, not recurring) |
| **Total** | **~$7–10 / month + a one-time ~€10 LLM prepay** |

The $100 Azure Student credits should last ~10–14 months at this rate.

---

## 5. Data Model (Database Schema)

All tables are in Supabase Postgres. **RLS is enabled on every table**; policies ensure users only see/modify their own rows.

### 5.1 Tables

```sql
-- Users are managed by Supabase Auth in auth.users.
-- We extend with a public profile table.

CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  display_name TEXT,
  preferred_language TEXT DEFAULT 'auto' CHECK (preferred_language IN ('auto','en','el')),
  renewal_lead_days INT DEFAULT 3,
  monthly_review_enabled BOOLEAN DEFAULT TRUE,
  onboarding_completed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,                   -- "Claude Pro", "Netflix", etc.
  service_key TEXT,                     -- normalized key, e.g., "claude", "netflix" (for matching with curated guide DB and extension)
  category TEXT,                        -- "ai_tool", "streaming", "productivity", "cloud_storage", "other"
  price NUMERIC(10,2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD', -- ISO 4217
  billing_cycle TEXT NOT NULL CHECK (billing_cycle IN ('monthly','yearly','weekly','quarterly','custom')),
  start_date DATE NOT NULL,
  next_renewal_date DATE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','cancelled','paused')),
  cancellation_date DATE,
  is_trackable_by_extension BOOLEAN DEFAULT FALSE,
  tracked_domain TEXT,                  -- e.g. "claude.ai" (only set if is_trackable_by_extension)
  cost_per_hour_target NUMERIC(10,2),   -- optional budget threshold
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Tracked usage from the browser extension (per session/day)
CREATE TABLE usage_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  subscription_id UUID REFERENCES subscriptions(id) ON DELETE SET NULL,
  domain TEXT NOT NULL,
  active_seconds INT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,     -- bucketed (e.g., per session or per hour)
  source TEXT NOT NULL CHECK (source IN ('extension','manual_report')),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX usage_events_user_subscription_idx ON usage_events(user_id, subscription_id, occurred_at);

-- Self-reported usage from monthly review (for non-trackable subs)
CREATE TABLE manual_usage_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  subscription_id UUID NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  report_month DATE NOT NULL,           -- first day of the month being reported
  reported_hours NUMERIC(6,2),
  reported_usage_label TEXT,            -- optional categorical label e.g. "heavy", "light", "none"
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, subscription_id, report_month)
);

-- Chat history
CREATE TABLE conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT,                           -- auto-generated from first message
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user','assistant','tool','system')),
  content TEXT,                         -- final text content
  tool_calls JSONB,                     -- if assistant called tools this turn
  tool_call_id TEXT,                    -- if role='tool', references the call
  structured_payload JSONB,             -- inline charts/tables payload, if any
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX messages_conversation_idx ON messages(conversation_id, created_at);

-- Monthly insights reports (persisted snapshots)
CREATE TABLE monthly_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  report_month DATE NOT NULL,           -- first day of the month
  payload JSONB NOT NULL,               -- full structured report
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, report_month)
);

-- Web Push subscriptions per user/device
CREATE TABLE push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL,
  p256dh_key TEXT NOT NULL,
  auth_key TEXT NOT NULL,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, endpoint)
);

-- Long-lived tokens for the browser extension (per user/device)
CREATE TABLE extension_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,             -- hashed (never store plaintext)
  label TEXT,                           -- "My MacBook Chrome"
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  revoked_at TIMESTAMPTZ
);

-- Curated subscription guidance (global, not per-user) — populated by seed data
CREATE TABLE service_guides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_key TEXT UNIQUE NOT NULL,     -- "netflix", "claude", etc.
  display_name TEXT NOT NULL,
  category TEXT,
  cancel_url TEXT,
  signup_url TEXT,
  cancel_steps JSONB,                   -- ordered list of steps
  plans JSONB,                          -- list of plan tiers
  tracked_domains TEXT[],               -- domains the extension watches
  is_trackable_by_extension BOOLEAN DEFAULT FALSE,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Uploaded invoice files (metadata; binary in Supabase Storage)
CREATE TABLE invoice_uploads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,           -- supabase storage path
  original_filename TEXT,
  content_type TEXT,
  extraction_status TEXT CHECK (extraction_status IN ('pending','processing','completed','failed')),
  extracted_payload JSONB,              -- the candidate subscriptions
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### 5.2 RLS Policy Examples

```sql
-- Pattern: every user-scoped table gets policies like these.

ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own subscriptions"
  ON subscriptions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own subscriptions"
  ON subscriptions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own subscriptions"
  ON subscriptions FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own subscriptions"
  ON subscriptions FOR DELETE
  USING (auth.uid() = user_id);

-- service_guides is global / read-only for users:
ALTER TABLE service_guides ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone authenticated can read guides"
  ON service_guides FOR SELECT
  USING (auth.role() = 'authenticated');
```

Same pattern applies to `profiles`, `usage_events`, `manual_usage_reports`, `conversations`, `messages`, `monthly_reports`, `push_subscriptions`, `extension_tokens`, `invoice_uploads`.

---

## 6. API Surface (FastAPI)

All endpoints are prefixed with `/api/v1`. Authentication via `Authorization: Bearer <supabase_jwt>` header on user endpoints, or `X-Extension-Token: <ext_token>` on extension endpoints.

### 6.1 Auth
Auth is handled by Supabase directly from the frontend — no `/auth/*` endpoints on the backend. The backend only **verifies** JWTs.

### 6.2 Subscriptions
- `GET /subscriptions` — list (with filters)
- `POST /subscriptions` — create
- `GET /subscriptions/{id}` — detail
- `PATCH /subscriptions/{id}` — update
- `DELETE /subscriptions/{id}` — delete
- `POST /subscriptions/{id}/cancel` — mark cancelled

### 6.3 Usage
- `POST /usage/events` — batch ingest from extension (uses extension token)
- `GET /usage/{subscription_id}` — usage history
- `POST /usage/manual-report` — self-reported monthly usage

### 6.4 Chat
- `GET /conversations` — list user's conversations
- `POST /conversations` — create new conversation
- `GET /conversations/{id}/messages` — full history
- `POST /conversations/{id}/messages` — send a message → **returns SSE stream**
- `DELETE /conversations/{id}` — delete

### 6.5 Reports & Insights
- `GET /reports` — list of monthly reports
- `GET /reports/{month}` — specific monthly report
- `POST /reports/generate` — generate insights now (on-demand)

### 6.6 Invoices
- `POST /invoices/upload` — upload PDF / .eml / text → returns `invoice_upload_id`
- `GET /invoices/{id}` — get extraction status and candidates
- `POST /invoices/{id}/confirm` — confirm selected candidates → creates subscriptions

### 6.7 Notifications
- `POST /push/subscribe` — register web push subscription
- `DELETE /push/subscribe/{endpoint}` — unregister
- `POST /push/test` — send a test notification (dev only)

### 6.8 Extension
- `POST /extension/tokens` — issue a new extension token (user-authenticated)
- `GET /extension/tokens` — list active tokens
- `DELETE /extension/tokens/{id}` — revoke
- `POST /extension/usage` — extension uploads usage events (uses extension token, not JWT)

### 6.9 Settings
- `GET /me` — current user profile
- `PATCH /me` — update profile / preferences

### 6.10 Health
- `GET /health` — liveness
- `GET /ready` — readiness (DB ping, Groq ping)

---

## 7. Repository Structure

**Monorepo on GitHub.**

```
saas-subscription-auditor/
├── README.md
├── docker-compose.yml              # local dev orchestration
├── .gitignore
├── .env.example                    # template — actual .env files are gitignored
│
├── frontend/                       # React + Vite + TS
│   ├── Dockerfile
│   ├── package.json
│   ├── vite.config.ts
│   ├── tsconfig.json
│   ├── tailwind.config.js
│   ├── src/
│   │   ├── main.tsx
│   │   ├── App.tsx
│   │   ├── routes/                 # route components
│   │   ├── features/               # feature-scoped components (chat, dashboard, subs, etc.)
│   │   ├── components/ui/          # shadcn/ui components
│   │   ├── lib/
│   │   │   ├── supabase.ts
│   │   │   ├── api.ts              # backend client
│   │   │   └── sse.ts              # EventSource helpers
│   │   ├── stores/                 # zustand stores
│   │   ├── i18n/                   # en.json, el.json
│   │   └── service-worker.ts       # Web Push handler
│   └── public/
│
├── backend/                        # FastAPI
│   ├── Dockerfile
│   ├── pyproject.toml              # uv / poetry / pip-tools — pick one (see §9)
│   ├── requirements.txt            # if using pip
│   ├── app/
│   │   ├── main.py                 # FastAPI entrypoint
│   │   ├── config.py               # settings (Pydantic Settings)
│   │   ├── deps.py                 # FastAPI dependencies (auth, db)
│   │   ├── routers/
│   │   │   ├── subscriptions.py
│   │   │   ├── usage.py
│   │   │   ├── chat.py             # SSE-streaming endpoint
│   │   │   ├── reports.py
│   │   │   ├── invoices.py
│   │   │   ├── notifications.py
│   │   │   ├── extension.py
│   │   │   └── me.py
│   │   ├── services/               # business logic
│   │   │   ├── llm.py              # Groq client + streaming wrapper
│   │   │   ├── tools.py            # tool definitions + dispatcher
│   │   │   ├── invoice_parser.py
│   │   │   ├── push.py             # pywebpush wrapper
│   │   │   ├── reports.py          # monthly report generator
│   │   │   └── analytics.py
│   │   ├── models/                 # Pydantic schemas (request/response)
│   │   ├── db/
│   │   │   ├── client.py           # asyncpg / supabase-py
│   │   │   └── migrations/         # SQL migration files
│   │   ├── jobs/
│   │   │   └── scheduler.py        # APScheduler setup
│   │   └── utils/
│   └── tests/                      # pytest
│
├── extension/                      # Chromium extension (MV3)
│   ├── manifest.json
│   ├── vite.config.ts
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── background.ts           # service worker
│       ├── content/                # content scripts (if any)
│       └── lib/
│           ├── tracker.ts          # time tracking logic
│           └── api.ts              # backend client (uses extension token)
│
├── infra/                          # Infrastructure as docs / scripts
│   ├── azure/
│   │   ├── README.md               # manual setup steps
│   │   └── bicep/ (optional)       # IaC if/when desired
│   └── supabase/
│       ├── schema.sql              # full schema dump
│       └── seed/
│           └── service_guides.sql  # curated guidance DB
│
└── .github/
    └── workflows/
        ├── backend.yml             # build, test, push to ACR, deploy to Container Apps
        ├── frontend.yml            # build, deploy to Static Web Apps
        └── extension.yml           # build artifact (manual upload to Chrome Web Store)
```

---

## 8. Local Development

### 8.1 Database Strategy

The developer uses **Supabase Cloud** (free tier) for both local and production work, with **two separate Supabase projects**:
- `subscription-auditor-dev` — used by local dev
- `subscription-auditor-prod` — used by deployed app

Both are free. Migrations are applied to dev first, then to prod.

### 8.2 Docker Compose

`docker-compose.yml` orchestrates the **frontend** and **backend** locally:

```yaml
services:
  backend:
    build: ./backend
    ports: ["8000:8000"]
    env_file: ./backend/.env
    volumes:
      - ./backend/app:/app/app   # hot reload
    command: uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

  frontend:
    build: ./frontend
    ports: ["5173:5173"]
    env_file: ./frontend/.env.local
    volumes:
      - ./frontend/src:/app/src
    command: npm run dev -- --host 0.0.0.0
```

(The Chrome extension is loaded "unpacked" into Chrome directly — not via Docker.)

### 8.3 Environment Variables

`.env` files are **gitignored**. `.env.example` files are committed as templates.

**Backend `.env` (development):**
```
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_JWT_SECRET=
GROQ_API_KEY=
VAPID_PRIVATE_KEY=
VAPID_PUBLIC_KEY=
VAPID_SUBJECT=mailto:...
DATABASE_URL=
APPLICATIONINSIGHTS_CONNECTION_STRING=    # optional locally
ENV=development
```

**Frontend `.env.local`:**
```
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
VITE_API_BASE_URL=http://localhost:8000/api/v1
VITE_VAPID_PUBLIC_KEY=
```

**Extension** — VITE-injected build constants for `VITE_API_BASE_URL`.

In **production**, all backend secrets come from **Azure Key Vault** (referenced by the Container App). Frontend env vars are baked in at build time via GitHub Actions secrets.

### 8.4 Local Workflow

```
git clone <repo>
cp backend/.env.example backend/.env       # fill in dev Supabase + Groq creds
cp frontend/.env.example frontend/.env.local
docker compose up
# Frontend: http://localhost:5173
# Backend:  http://localhost:8000 (Swagger at /docs)
```

For the extension: `npm run dev` inside `extension/`, then load `extension/dist` as unpacked in `chrome://extensions`.

---

## 9. Deployment

### 9.1 Hosting

| Component | Where |
|---|---|
| Frontend (built React bundle) | **Azure Static Web Apps** (free tier) |
| Backend (Dockerized FastAPI) | **Azure Container Apps** (consumption plan, scale-to-zero, `minReplicas: 0`) |
| Docker images | **Azure Container Registry** (Basic) |
| Secrets | **Azure Key Vault**, referenced by Container App |
| Logs/metrics | **Azure Application Insights** |
| DB / Auth / Storage | **Supabase** |
| LLM | **Google Gemini** (Groq fallback) |
| Push delivery | Browser push services via VAPID |

### 9.2 CI/CD (GitHub Actions)

Two main workflows:

**`.github/workflows/backend.yml`** — triggers on changes to `backend/**` on `main`:
1. Run `pytest`.
2. Build Docker image.
3. Push image to Azure Container Registry.
4. Update the Azure Container App revision to the new image tag.

**`.github/workflows/frontend.yml`** — triggers on changes to `frontend/**` on `main`:
1. Run `npm run lint && npm run build`.
2. Deploy build output to Azure Static Web Apps via the official action.

**`.github/workflows/extension.yml`** — triggers on changes to `extension/**` on tag push:
1. Build the extension bundle.
2. Upload as an artifact (manual submission to Chrome Web Store).

### 9.3 SSE Through Container Apps

Important deployment detail: **Server-Sent Events must not be buffered** by the ingress. Configure the Container App's ingress / response headers to disable buffering for the chat streaming endpoint (`Cache-Control: no-cache`, `X-Accel-Buffering: no`). Verify after deploy that streamed chunks arrive incrementally, not all at once.

### 9.4 Scheduled Jobs

`APScheduler` runs **in-process inside the FastAPI container**. Because `minReplicas: 0`, the container may be cold when a job is due.

**Mitigation**: Set `minReplicas: 1` for the time windows when scheduled jobs need to run, **or** trigger scheduled work via an external pinger (e.g., GitHub Actions cron hitting `/jobs/run-due`). Choose whichever is simpler to implement; the trade-off is cost vs. reliability.

---

## 10. Security & Privacy

### 10.1 Authentication & Authorization
- Supabase Auth handles all login/signup/reset/OAuth flows.
- Backend verifies JWTs via Supabase JWKS on every protected request.
- Backend passes the user's JWT to Supabase when querying, so **RLS policies enforce data scoping**.
- The service role key is used **only** for admin operations that legitimately need to bypass RLS (e.g., system jobs).

### 10.2 Extension Token Handling
- Extension tokens are random, high-entropy strings.
- Only the **hash** (e.g., SHA-256) is stored in `extension_tokens.token_hash`.
- Tokens can be revoked at any time via the settings UI.
- Tokens are scoped to extension endpoints only (cannot perform user CRUD).

### 10.3 Input & Output Safety
- All API inputs validated via Pydantic.
- LLM tool calls are validated against their Pydantic schemas before execution — never trust the LLM's raw output structure.
- Malformed tool calls are caught and the LLM is given a clear error message to retry.
- File uploads are size-limited (e.g., 10 MB) and content-type-checked.

### 10.4 Secrets
- No secrets in the repo, ever. `.env` files are gitignored.
- In production, secrets are stored in Azure Key Vault and exposed to the Container App as environment variables via secret references.
- VAPID keys are generated once and stored alongside other secrets.

### 10.5 Privacy
- The app does **not** integrate with banks or store financial credentials.
- Invoice uploads are stored in Supabase Storage with user-scoped access (RLS-equivalent policies on storage buckets).
- Users can export and delete all their data (GDPR-aligned).
- A legal disclaimer is shown on first onboarding and in Settings, clarifying that AI-generated advice is not professional financial advice.

### 10.6 Rate Limiting
- A simple per-user-per-endpoint rate limiter on the chat endpoint to prevent runaway LLM usage (e.g., 30 messages/minute).
- Extension event ingestion is rate-limited by the backend (e.g., 1 batch/min/token).

---

## 11. Observability

- **Application Insights** ingests structured logs (`structlog` → Azure exporter) and request traces.
- Key events to log: every tool call (name, latency, success), every LLM call (model, tokens used, latency), every job execution, every failed auth.
- Avoid logging PII or message content at INFO level.
- **Free tier is 5 GB/month** — log smart, not everything.

---

## 12. Conventions & Standards

### 12.1 Python (Backend)
- **Formatting**: `black`.
- **Linting**: `ruff`.
- **Type hints**: required on all public functions, validated with `mypy` (loose mode).
- **Async**: use `async def` for any IO; sync only for pure computation.
- **Imports**: absolute imports within `app/`.
- **Errors**: raise `HTTPException` for client errors; let unexpected exceptions bubble (caught by FastAPI handler → 500).

### 12.2 TypeScript (Frontend + Extension)
- **Formatting**: `prettier`.
- **Linting**: `eslint` (with `@typescript-eslint`).
- **Strict mode**: `strict: true` in `tsconfig.json`.
- **Components**: function components only, no class components.
- **Naming**: `PascalCase` for components, `camelCase` for everything else.

### 12.3 Git
- **Branches**: `main` is always deployable. Feature branches: `feat/...`, `fix/...`, `chore/...`.
- **Commits**: prefer Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`).
- **PRs**: not required (solo dev), but **commit often** to preserve work.

### 12.4 Pre-commit Hooks
- Use `pre-commit` framework.
- Hooks: `black`, `ruff`, `prettier`, `eslint`, basic secret scanning.

### 12.5 Frontend Design Principles
- **Dark mode is the default and primary design target.** Light mode is a secondary concern.
- All numbers, dates, and currencies are **localized** based on the active language (en/el).
- Forms use `react-hook-form` + `zod` schemas — never uncontrolled inputs for important data.
- Server state is always managed by `TanStack Query` — never raw `useEffect + fetch` for data fetching.
- Use `shadcn/ui` components rather than rolling custom UI when an equivalent exists.
- Inline charts in chat use the same `Recharts` components as the dashboard for visual consistency.

### 12.6 LLM Integration Principles
- **Tools are the source of truth**, not the LLM. The LLM never directly mutates DB state — it calls tools that do.
- **Validate every tool call payload** with Pydantic before execution.
- **Stream responses always** for chat (SSE).
- **Truncate conversation history** to a sliding window of the last ~20 messages (configurable) to control token cost.
- **Auto-generate conversation titles** from the first user message via a small follow-up LLM call (use the smaller/cheaper model).
- **Log token usage** per call to Application Insights for cost monitoring.

---

## 13. Out of Scope (Explicit)

To prevent scope creep, the following are **explicitly out of scope**:

- ❌ Bank account linking (Plaid, TrueLayer, etc.).
- ❌ Gmail / inbox API integration.
- ❌ Inbound email forwarding addresses.
- ❌ Mobile native apps (iOS / Android). The web app is responsive; that is the mobile experience.
- ❌ Multi-agent architectures or LangChain.
- ❌ Actually cancelling subscriptions on third-party sites.
- ❌ Bill negotiation services (Rocket Money-style).
- ❌ General-purpose budgeting (income tracking, savings goals, investments).
- ❌ Team / family / shared accounts.
- ❌ Payment processing (the app does not handle the user's money — it only tracks records).
- ❌ Browsers other than Chromium-based for the extension.

These can be future enhancements but should not influence current design.

---

## 14. Open Questions (To Resolve During Build)

These are decisions intentionally left for the implementation phase:

1. **Final chatbot name** (or let users name it).
2. **Curated `service_guides` initial seed list** — exact services to pre-populate (suggested starting set: Netflix, Spotify, ChatGPT, Claude, Gemini, Perplexity, GitHub Copilot, Cursor, Disney+, HBO Max, Apple Music, YouTube Premium, Notion, Dropbox, iCloud, Google One).
3. **Exact monthly report payload schema** (what fields, in what structure).
4. **Renewal reminder time-of-day** (e.g., 9am user local time? UTC?).
5. **Whether scheduled jobs use in-process APScheduler with `minReplicas: 1` or external pinger** (cost vs. reliability trade-off).
6. **Bot personality / tone** — neutral helpful vs. slightly playful (Cleo-style).
7. **Manual usage report format** — hours numeric input, qualitative dropdown ("heavy / light / none"), or both.

---

## 15. References & Inspirations

Built with awareness of (not copying) the following competitors:

- **Rocket Money** — bank-linked subscription detection. (Out of scope here.)
- **Bobby (iOS)** — manual subscription tracker, privacy-focused.
- **Monarch Money** — Recurring tab + calendar view + 3-day renewal alerts. (Inspired our renewal default.)
- **QuotaMeter** — AI tool budget alerts at 70/85/95% thresholds. (Inspired our cost-per-hour target feature.)
- **Claude Usage Tracker** — GitHub-style heatmap. (Inspired our usage heatmap in the detail view.)
- **Cleo** — conversational AI personality. (Reference for chatbot tone discussion.)

---

*End of specification.*
