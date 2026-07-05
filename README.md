# SaaS Subscription Auditor

A personal web app that helps you track, analyze, and optimize all your recurring subscriptions — AI tools, streaming, productivity apps, etc.

Built as a portfolio project and something you'll actually use daily.

---

## What It Does

- **Chat with an AI assistant** to manage your subscriptions using plain language ("Add Claude Pro, $20/month" or "How much am I spending on AI tools?"). Works in English and Greek.
- **Dashboard** showing your monthly spend, upcoming renewals, and charts.
- **Browser extension** that silently tracks how much time you spend on AI tools (Claude, ChatGPT, Gemini, etc.) so you can see cost-per-hour.
- **Push notifications** reminding you before a subscription renews (default: 3 days before).
- **Invoice import** — upload a PDF bank statement and the AI extracts your subscriptions automatically.
- **Monthly reports** with AI-generated insights and suggestions.

---

## Tech Stack — The Short Version

Think of it in three parts: a frontend the user sees, a backend that does the work, and external services we rely on.

### Frontend (what the user sees in the browser)
| What | Tool | Why |
|---|---|---|
| UI framework | **React + Vite** | React builds the interactive interface; Vite makes development fast |
| Language | **TypeScript** | JavaScript with type checking — catches bugs before they happen |
| Styling | **Tailwind CSS** | Utility classes applied directly in HTML — no separate CSS files |
| Component library | **shadcn/ui** | Pre-built UI components (buttons, forms, modals) we own and can customize |
| Charts | **Recharts** | Draws the spend/usage charts |
| Icons | **lucide-react** | Icon set used throughout the UI |
| Routing | **React Router v6** | Handles navigation between pages (Overview, Chat, Settings, etc.) |
| Forms | **React Hook Form + Zod** | Forms with built-in validation |
| Data fetching | **TanStack Query** | Fetches data from the backend and caches it |
| Global state | **Zustand** | Lightweight store for shared app state (e.g., current user) |
| Auth client | **@supabase/supabase-js** | Talks to Supabase Auth for login/logout |
| Streaming | **EventSource (SSE)** | Receives the AI assistant's response word-by-word as it's generated |
| Translations | **react-i18next** | Switches UI text between English and Greek |

### Backend (the server that runs the logic)
| What | Tool | Why |
|---|---|---|
| Framework | **FastAPI** | Python web framework — handles API requests and returns responses |
| Server | **Uvicorn** | Runs FastAPI; handles many requests concurrently |
| Validation | **Pydantic v2** | Validates and parses all incoming data so nothing unexpected gets in |
| Database client | **asyncpg / supabase-py** | Talks to the Postgres database |
| Auth verification | **pyjwt** | Checks that the user's login token is real before serving protected data |
| AI model client | **groq SDK** | Sends messages to Llama 3.3 (the AI model) and receives responses |
| PDF reading | **pdfplumber** | Extracts text from uploaded bank statement PDFs |
| OCR fallback | **pytesseract** | Used when a PDF is image-based and pdfplumber can't extract text |
| Push notifications | **pywebpush** | Sends browser push notifications for renewal reminders |
| Scheduled jobs | **APScheduler** | Runs tasks on a schedule (e.g., check renewals daily, generate monthly reports on the 1st) |
| Logging | **structlog** | Structured logs that go to Azure Application Insights |

### External Services
| Service | What it does |
|---|---|
| **Supabase** | Hosts the Postgres database, handles user authentication, and stores uploaded files |
| **Groq** | Provides the Llama 3.3 70B AI model we use for the chatbot and invoice extraction |
| **Azure Container Apps** | Hosts the backend (Docker container, scales to zero when idle to save cost) |
| **Azure Static Web Apps** | Hosts the built frontend (free tier) |
| **Azure Key Vault** | Stores secrets (API keys, tokens) securely in production |
| **Azure Application Insights** | Collects logs and performance metrics |
| **Browser Push Services** | Deliver push notifications (handled via VAPID — a standard that works across browsers) |

### Browser Extension
| What | Tool |
|---|---|
| Standard | Manifest V3 (the current Chrome extension format) |
| Language | TypeScript |
| Build | Vite |
| Background logic | Service worker (runs silently, tracks which AI tool tab is active) |

---

## How the AI Assistant Works

The chatbot is one AI model (Llama 3.3 via Groq) with a set of **tools** it can call. The flow each time you send a message:

```
Your message
    ↓
AI model decides which tools to call (0 or more)
    ↓
Backend runs the tools (e.g., query DB, compute analytics)
    ↓
Tool results are fed back to the AI
    ↓
AI writes a response → streamed word-by-word to your screen
```

Tools the AI can call include things like `add_subscription`, `query_subscriptions`, `get_analytics`, and `render_chart`. The AI never directly touches the database — it calls tools that do.

---

## How the Extension Works

The browser extension runs as a **service worker** (background script) in Chrome. It watches which tab is active and focused, and records time spent on tracked AI tool domains (e.g., `claude.ai`, `chat.openai.com`). Every few minutes it sends a batch of usage events to the backend. The backend links those events to your subscriptions and computes cost-per-hour.

The extension authenticates using a long-lived token you generate in the app's Settings, so you don't have to log in separately.

---

## How Push Notifications Work

The app uses the **Web Push API with VAPID**. This is a browser standard — no third-party push service needed. When you enable notifications:

1. Your browser registers a unique push endpoint with your browser's push service (e.g., Google's for Chrome).
2. That endpoint is saved in the backend.
3. When a renewal is due (or it's the 1st of the month), the backend sends a push message to that endpoint using your VAPID keys.
4. Your browser receives it and shows the notification — even if the app tab is closed.

---

## Data & Privacy

- **No bank linking.** You upload statements manually (or type subscriptions in).
- **No financial credentials stored.** Ever.
- **Row-Level Security (RLS)** in Supabase means every database query is automatically filtered to your own data — even if a bug in the code tried to fetch someone else's data, the database would block it.
- **GDPR-aligned**: you can export and delete all your data.

---

## Project Layout

```
saas-subscription-auditor/
├── frontend/          ← React app (Vite + TypeScript)
├── backend/           ← FastAPI app (Python)
├── extension/         ← Chrome extension (Manifest V3)
├── infra/             ← Azure setup notes + Supabase schema
├── docs/              ← Project docs (spec, session plan, learning resources)
├── docker-compose.yml ← Runs frontend + backend locally together
└── .github/workflows/ ← CI/CD pipelines (auto-deploy on push)
```

---

## Running Locally

```bash
git clone <repo>
cp backend/.env.example backend/.env       # fill in your Supabase + Groq keys
cp frontend/.env.example frontend/.env.local
docker compose up
```

- Frontend: http://localhost:5173
- Backend API + docs: http://localhost:8000/docs

For the extension: run `npm run dev` inside `extension/`, then go to `chrome://extensions` → Load unpacked → select `extension/dist`.

---

## Code Quality (pre-commit)

Formatting, linting, and secret scanning run automatically on every commit via [pre-commit](https://pre-commit.com/), configured in `.pre-commit-config.yaml`.

```bash
uv tool install pre-commit   # one-time, any machine with uv installed
pre-commit install           # wires the git hook for this clone
pre-commit run --all-files   # run every hook against the whole repo on demand
```

Hooks: `ruff` + `black` (backend, via `backend/pyproject.toml`), `eslint` + `prettier` (frontend, via the frontend's own configs), `gitleaks` (blocks commits containing credential-shaped strings), plus basic hygiene checks (trailing whitespace, end-of-file newline, merge conflict markers, large files).

---

## Docs

All detailed documents are in the `docs/` folder:

| File | What's in it |
|---|---|
| `docs/APP_DESCRIPTION.md` | Full technical specification — features, architecture, data model, API surface |
| `docs/APM_SESSIONS.md` | How the build is split into sessions (what gets built in what order) |
| `docs/LEARNING_RESOURCES.md` | Curated links to learn the tech stack before starting |
