# Subscription Auditor

A personal web app for tracking, analyzing, and optimizing recurring subscriptions — AI tools,
streaming, productivity apps. Bilingual (English/Greek), dark-mode dashboard, with an AI assistant
as the primary interface.

Built as a portfolio project and for personal daily use. Deployed and in use by a small group of
beta testers.

*Developed with AI assistance (Claude), coordinated through the
[Agentic Project Management](https://github.com/sdi2200262/agentic-project-management) framework.
See [Development Process](#development-process) for how the work was directed and reviewed, and
[`.apm/`](.apm/archives/README.md) for the full record.*

---

## What It Does

**Built and deployed:**

- **Chat with an AI assistant** to manage subscriptions in plain language — "Add Claude Pro,
  $20/month", "How much am I spending on AI tools?". Works in English and Greek.
- **Dashboard** with monthly spend, upcoming renewals, and charts, including multi-currency
  totals converted at cached FX rates.
- **Push notifications** before a subscription renews, with a per-user default lead time and a
  per-subscription override. Delivered via Web Push; the daily check runs as a scheduled job.
- **Subscription management** — add, edit, pause, cancel, and categorise, from either the UI or
  the chat.
- **Cancellation guidance** — the assistant answers "how do I cancel X?" from a curated table of
  verified services, clearly distinguishing verified steps from unverified model-generated ones.

**Planned, not yet built** — these are on the roadmap and are described in
[`docs/APM_SESSIONS.md`](docs/APM_SESSIONS.md), but no implementation exists yet:

- **Browser extension** for tracking time spent in subscribed tools. `extension/` currently holds
  a README only.
- **Cost-per-hour and usage analytics**, which depend on the extension. The subscription detail
  view shows explicit placeholders rather than fabricated numbers.
- **Invoice import** — uploading a PDF statement for automatic extraction.
- **Monthly reports** with AI-generated insights.
- **Data export and account deletion.** Row-Level Security is enforced today, but the GDPR
  export/delete flows are not implemented yet.

---

## Tech Stack

### Frontend

| Tool | Role in this project |
|---|---|
| **React 19 + Vite** | Component tree and dev/build tooling. Function components only |
| **TypeScript** (`strict`) | Enforced across app and test files; the CI build type-checks tests, which the test runner alone does not |
| **Tailwind CSS v4** | All styling. Dark mode is the default and primary design target |
| **shadcn/ui** (Base UI preset) | Component primitives vendored into the repo and owned directly, rather than pulled from a dependency |
| **TanStack Query** | Every server read and mutation, with cache invalidation on success. No raw `useEffect` + `fetch` anywhere in the app |
| **React Router v7** | Route tree, including the guard that resolves onboarding *before* the dashboard mounts |
| **React Hook Form + Zod** | Form state and client validation. Zod is UX-only — the backend re-validates everything |
| **Recharts** | Spend-over-time, category breakdown, and the chart payloads the assistant can render |
| **react-i18next** | Runtime EN/EL switching against locale files kept at exact key parity (355 keys) |
| **marked + DOMPurify** | Renders assistant markdown through a strict tag allowlist. No `dangerouslySetInnerHTML` |
| **date-fns** | Renewal-date arithmetic and billing-cycle math |
| **`fetch` + ReadableStream** | Consumes the assistant's SSE token stream. Chosen over `EventSource`, which can neither send an `Authorization` header nor POST a request body — this endpoint needs both |

### Backend

| Tool | Role in this project |
|---|---|
| **FastAPI** | HTTP layer. Strict `routers/` → `services/` → `db/` layering, no leakage between them |
| **Uvicorn** | ASGI server, running the app in a container |
| **Pydantic v2** | Validates every inbound payload, including every LLM tool call before it executes. The backend is the trust boundary |
| **asyncpg** | Postgres access with a connection pool. Parameterized SQL only; RLS is the second wall |
| **pyjwt** | Verifies the Supabase JWT via JWKS (ES256) on every protected request ([ADR 0001](docs/adr/0001-jwt-verification-via-jwks-es256.md)) |
| **httpx** | The provider-agnostic transport for model calls — no vendor SDK ([ADR 0002](docs/adr/0002-provider-agnostic-llm-layer-over-httpx.md)) |
| **pywebpush** | Encrypts and delivers Web Push payloads to per-device endpoints, and reports permanent rejections so dead devices are pruned |
| **limits** | Per-user chat rate limiting, per-IP auth limiting, and a per-user daily LLM spend ceiling |

### Infrastructure

| Service | Role in this project |
|---|---|
| **Supabase** | Postgres, Auth, and Storage. RLS policies on every user-scoped table, proven by cross-user denial tests |
| **Google Gemini** | The assistant's model (`gemini-3.1-flash-lite`), reached through the httpx layer |
| **Azure Container Apps** | Runs the backend container, scaling to zero when idle |
| **Azure Static Web Apps** | Serves the built frontend and applies the security headers, including the CSP |
| **Azure Key Vault** | Holds production secrets, referenced by the Container App rather than baked into images |
| **Azure Application Insights** | Logs and metrics. Counts and outcomes only — never message content or PII |
| **GitHub Actions** | CI/CD on push, plus the daily cron that triggers the reminder job |

### Choices worth noting

| | |
|---|---|
| **httpx, not a vendor SDK** | The LLM layer is provider-agnostic ([ADR 0002](docs/adr/0002-provider-agnostic-llm-layer-over-httpx.md)). It survived a Groq → Gemini migration without touching callers; Groq remains a documented fallback adapter |
| **Gemini pinned to `gemini-3.1-flash-lite`** | The floating `-latest` alias re-pointed to a new model generation mid-development and changed assistant behaviour with no code change |
| **asyncpg, not an ORM** | Parameterized SQL throughout, with RLS as the second wall |
| **Zod is UX-only** | The backend re-validates everything; it is the trust boundary |
| **marked + DOMPurify** | Assistant output renders through a strict tag allowlist. No `dangerouslySetInnerHTML`, and model-generated URLs are never linkified |
| **No in-process scheduler** | Scheduled work is triggered externally by GitHub Actions, keeping the backend stateless and horizontally scalable ([ADR 0003](docs/adr/0003-lazy-refresh-fx-cache-no-scheduler.md)) |
| **Hand-authored service worker** | Rather than a generated one ([ADR 0004](docs/adr/0004-hand-authored-service-worker.md)) |

---

## How the AI Assistant Works

The assistant is a single model with a registry of **tools** it can call. No agent framework, no
multi-agent orchestration. Each message:

```
Your message
    ↓
Model decides which tools to call (0 or more)
    ↓
Backend validates each tool payload, then runs it (query DB, compute analytics)
    ↓
Tool results are fed back to the model
    ↓
Model writes a reply → streamed token-by-token to the screen
```

Registered tools include `add_subscription`, `query_subscriptions`, `get_analytics`,
`get_subscription_guide`, `mark_subscription_cancelled`, and `delete_subscription`. **The model
never touches the database directly** — it calls tools that do, and every tool payload is validated
against a Pydantic schema before execution. Every figure shown in chat comes from a tool result
computed against the database, never from text the model produced freely.

---

## How Push Notifications Work

The app uses the **Web Push API with VAPID** — a browser standard, with no third-party push
service. When notifications are enabled:

1. The browser registers a unique push endpoint with its own push service (Google's for Chrome,
   Apple's for Safari).
2. That endpoint and its encryption keys are stored per-device in the backend.
3. A GitHub Actions cron job calls a token-authenticated endpoint on the backend once daily. The
   backend finds subscriptions renewing within their lead time and sends a push to each device.
4. The browser displays the notification, even with the app closed.

Delivery is recorded in a ledger with a uniqueness constraint, so a re-run or duplicated trigger
cannot send the same reminder twice. There is **no in-process scheduler** — the trigger is
external, which keeps the backend stateless and safe to scale horizontally.

iOS requires the app to be installed to the Home Screen before it will grant Web Push; the app
ships a manifest and instructions for that, though the iOS path is implemented-but-unverified (no
test device).

---

## Data & Privacy

- **No bank linking, and no financial credentials stored.** Subscriptions are entered manually or
  through the chat.
- **Row-Level Security (RLS)** in Supabase filters every query to the authenticated user. Even if
  application code had a bug and asked for another user's rows, the database would refuse. Every
  user-scoped table has a cross-user denial test proving this.
- **Auth is a Bearer JWT** in the `Authorization` header, never a cookie — CSRF is not applicable.
- **No PII or message content in logs.**
- **Strict Content-Security-Policy** on the served frontend; assistant output is sanitised and
  model-generated URLs are never rendered as clickable links.
- **Not yet implemented:** GDPR data export and full account deletion, and a published Privacy
  Policy. These are required before the app is opened beyond the current beta group.

---

## Project Layout

```
Subscription-Auditor/
├── frontend/          ← React app (Vite + TypeScript)
├── backend/           ← FastAPI app (Python 3.12)
├── extension/         ← Chrome extension — placeholder, not yet built
├── supabase/          ← Versioned SQL migrations
├── infra/             ← Azure setup notes + Supabase configuration
├── docs/              ← Specification, standards, decisions, ADRs
├── .apm/              ← Development process record
├── docker-compose.yml ← Runs frontend + backend locally
└── .github/workflows/ ← CI/CD pipelines + the daily reminder trigger
```

---

## Running Locally

```bash
git clone <repo>
cp backend/.env.example backend/.env       # Supabase + Gemini keys
cp frontend/.env.example frontend/.env.local
docker compose up
```

- Frontend: http://localhost:5173
- Backend API + interactive docs: http://localhost:8000/docs

Note that Web Push requires HTTPS, so notifications cannot be fully exercised against the local
dev server.

---

## Code Quality (pre-commit)

Formatting, linting, and secret scanning run automatically on every commit via
[pre-commit](https://pre-commit.com/), configured in `.pre-commit-config.yaml`.

```bash
uv tool install pre-commit   # one-time, any machine with uv installed
pre-commit install           # wires the git hook for this clone
pre-commit run --all-files   # run every hook against the whole repo on demand
```

Hooks: `ruff` + `black` (backend), `eslint` + `prettier` (frontend), `gitleaks` (blocks commits
containing credential-shaped strings), plus hygiene checks (trailing whitespace, end-of-file
newline, merge conflict markers, large files).

---

## Development Process

This application was built using an agentic AI workflow: the work was decomposed into discrete tasks and executed by Claude operating in defined roles (backend and data, frontend, infrastructure), coordinated under [Agentic Project Management](https://github.com/sdi2200262/agentic-project-management) — an open-source methodology by [@sdi2200262](https://github.com/sdi2200262), used here with thanks. My role was architecture and technology selection, decomposition of the work into staged tasks with explicit validation criteria, and review, testing, and debugging of every agent-produced change before it was merged. Manual and live verification against the running application was my responsibility throughout, and consistently surfaced issues that passing test suites did not. The full process record — specifications, task briefs, per-task logs, review notes, and agent handoffs across four development sessions — is published in [`.apm/`](.apm/archives/README.md).

---

## Documentation

Documentation lives in two folders, answering different questions. [`docs/`](docs/README.md)
describes **what the system is and why it is built this way**. [`.apm/`](.apm/archives/README.md) records
**how the work was carried out** — task briefs, agent logs, and review notes.

### [`docs/`](docs/README.md) — the system

| File | What's in it |
|---|---|
| [`APP_DESCRIPTION.md`](docs/APP_DESCRIPTION.md) | Full technical specification — features, architecture, data model, API surface. Describes the complete intended system, including the parts not yet built |
| [`ENGINEERING_STANDARDS.md`](docs/ENGINEERING_STANDARDS.md) | Non-negotiable standards for scalability, security, and privacy/GDPR. Enforced on every task |
| [`DECISIONS.md`](docs/DECISIONS.md) | Chronological log of cross-cutting decisions, with reasoning and tradeoffs — including those later reversed |
| [`adr/`](docs/adr/) | Architecture Decision Records for choices needing more room than a log entry |
| [`APM_SESSIONS.md`](docs/APM_SESSIONS.md) | How the build is split into independently deployable sessions |
| [`LEARNING_LOG.md`](docs/LEARNING_LOG.md) | Concepts encountered while building, with pointers into the code |
| [`LEARNING_RESOURCES.md`](docs/LEARNING_RESOURCES.md) | Curated links for learning the stack |

Also at the root: [`CLAUDE.md`](CLAUDE.md), the standing instruction file the AI agents operated
under — the mechanism by which the standards above were applied to every task.

### [`.apm/`](.apm/archives/README.md) — the process

The development process record described above: specifications, the staged task breakdown with
per-task validation criteria, one log per task, review notes, and agent handoffs across four
sessions. Start with [`.apm/archives/README.md`](.apm/archives/README.md), which explains the methodology and
suggests a reading order.

---

## Feedback

Suggestions, bug reports, and questions about the approach are welcome — open an
[issue](https://github.com/ArisS44/Subscription-Auditor/issues). Corrections to the documentation
are useful too, as are notes on Greek strings that read unnaturally.

This is a solo portfolio project rather than a maintained open-source library, so responses may be
slow and not every suggestion will be adopted. Small, focused pull requests are still welcome; see
[`CONTRIBUTING.md`](CONTRIBUTING.md) for what helps and how contributions are licensed.

**Security issues:** please do not open a public issue — use
[private vulnerability reporting](https://github.com/ArisS44/Subscription-Auditor/security/advisories/new)
instead.

---

## License

Copyright © 2026 Aristeidis Skyllas. Licensed under the
[PolyForm Noncommercial License 1.0.0](LICENSE) — free to read, study, modify, and use for any
noncommercial purpose, including research and education. Commercial use is not permitted.

Third-party assets are not covered and keep their own licenses; see [`NOTICE`](NOTICE).
