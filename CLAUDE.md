# CLAUDE.md — SaaS Subscription Auditor

Persistent project context. Read at the start of every session.

## What this is

A full-stack, AI-native web app to track/analyze/optimize recurring subscriptions. Bilingual (EN/GR)
chatbot as the primary interface, dark-mode dashboard, Chrome extension for AI-tool time tracking,
Web Push reminders, invoice import, monthly AI insights. Solo portfolio + personal-use + learning project.

- **Full spec:** `docs/APP_DESCRIPTION.md`
- **Session plan (build order):** `docs/APM_SESSIONS.md`
- **Engineering standards (MUST comply):** `docs/ENGINEERING_STANDARDS.md`
- **Cross-session decisions:** `docs/DECISIONS.md`

## Delivery strategy

7 independently deployable slices; deliverable is **adjustable at session boundaries**. **Soft target:
MVP = through Session 3, then deploy & reassess** whether Sessions 4–7 happen now or later. Defer
features only at session boundaries — never ship a session's security half-done. See `docs/DECISIONS.md`.

## Stack

React+Vite+TS · Tailwind · shadcn/ui · Recharts — FastAPI · Pydantic v2 · asyncpg — Supabase
(Postgres+Auth+Storage, RLS everywhere) · Groq (Llama 3.3 70B, tool-calling, SSE) · Azure Container
Apps + Static Web Apps + Key Vault + App Insights. Single-agent tool-calling — **no LangChain, no
multi-agent**.

## Non-negotiables (full detail in `docs/ENGINEERING_STANDARDS.md`)

**Scalable & modular**
- Strict layering: `routers/` (HTTP) → `services/` (logic) → `db/` (data). No leakage across layers.
- Stateless backend (scales horizontally). DB connection pooling. Paginate every list endpoint.
- Scheduler must not double-fire across replicas — design a single-owner mechanism (decide before Session 5).
- LLM tools live in a registry, not a hardcoded switch. Extension ingest is idempotent.

**Secure (all input is hostile)**
- Validate every input with Pydantic (backend is the trust boundary; Zod is UX only).
- Validate every LLM tool-call payload before execution. Treat LLM input AND output as untrusted (prompt injection).
- XSS: no raw HTML from LLM/DB; sanitize markdown (DOMPurify); ship a strict CSP.
- SQL injection: parameterized queries only; RLS as the second wall.
- CSRF: keep auth as Bearer JWT in the `Authorization` header — never cookies.
- SSRF: never fetch user-supplied URLs; if unavoidable, allowlist + block `169.254.169.254`.
- Rate-limit chat (per-user), auth (per-IP), extension ingest (per-token); cap per-user daily LLM spend.
- Resource-exhaustion guards (upload size caps, PDF/zip-bomb + parser timeouts) — the real analog of
  "buffer overflow" on a managed stack. Constant-time compare for token hashes. Security headers set.
- Secrets in Key Vault; `.env` gitignored; store only hashed extension tokens; least-privilege service role.

**Educational — teach live while building**
- The developer is new to most of the stack. **Explain _before_ building, pause work to teach every new
  concept before using it, build in small explained increments, and check understanding before moving on.**
  Interactive teaching during the build is the priority; comments/LEARNING_LOG/ADRs are secondary support.
- Comments explain _why_ (framework idioms). Per-session entry in `docs/LEARNING_LOG.md`. ADRs in
  `docs/adr/` for non-obvious choices. Clarity over cleverness.

## Conventions

- Python: `black` + `ruff`, type hints, `async def` for IO. TS: `prettier` + `eslint`, `strict: true`,
  function components only.
- Git: `main` is deployable; branches `feat/…` `fix/…` `chore/…`; Conventional Commits; commit often.
- APM `.apm/` files are the source of truth; chat is disposable. One session = one deployable slice.
