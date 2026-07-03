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

**Private & compliant (GDPR + ePrivacy)**
- Data minimization; don't send PII to Groq unless a feature needs it; no PII/message content in logs.
- Ship a Privacy Policy disclosing data collected + sub-processors (Supabase, Groq, Azure). Explicit
  opt-in for push + extension tracking + invoice uploads.
- Build real data-export + full-deletion (cascade DB **and** Storage). Cookies/local-storage: only
  strictly-necessary (auth token, language) → disclose, no consent banner needed while there's zero
  non-essential tracking. Don't add banner theater; if tracking is ever added, a proper opt-in banner
  becomes mandatory.

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

APM_RULES {

## Teaching cadence (every Task)

This is an execution requirement on all hands-on work, not just documentation — see the **Educational** non-negotiable above. Operationally, on every meaningful unit of work:
- **Explain before building.** State in plain English what you are about to do, why this approach, and which framework concept it introduces — then build.
- **Stop and teach at every new concept.** The first time the project touches a concept (e.g. FastAPI dependency, RLS policy, JWT verification, asyncpg pool, Docker layer, Vite build, a React hook, Supabase Auth flow, GitHub Actions, `az` CLI), pause and give a short focused explanation before writing the code that uses it. Session 1 introduces many first-time concepts — expect frequent teaching pauses.
- **Small increments, check understanding.** Build in small explained steps; after a non-trivial concept, invite questions / confirm before proceeding. Explain tradeoffs of the roads not taken. Assume strong general programming but little stack-specific knowledge.

## External-platform / User-driven steps

When a Task requires action outside the development environment (creating cloud projects, OAuth clients, running `supabase`/`az`/deploy commands against real accounts, setting deploy secrets), do not assume credentials or act on the User's behalf:
- Prepare exact, ordered, explained commands; teach the concept; then **pause for the User to execute and report results** before continuing.
- Never place real secrets in the repo — `.env` is gitignored, only `.env.example` templates are committed, and production secrets live in Key Vault.

## Security & privacy (any Task touching input, data, or secrets)

Apply the **Secure** and **Private & compliant** non-negotiables above. Always-on, concretely:
- Validate all inbound data with Pydantic on the backend (the trust boundary); Zod on the frontend is UX only. Parameterized SQL only — never string-built queries. Keep API auth as Bearer JWT in the `Authorization` header (never cookies).
- No PII or message content in logs. Set the standard security response headers where the Task produces HTTP responses.
- Security work ships complete for any surface that goes live — never leave a live surface half-secured.

## Layering & config

- Backend: strict `routers/` → `services/` → `db/` layering, no leakage. Frontend: feature-scoped modules. Config comes from environment only — no hardcoded hosts, keys, or magic numbers.

## Learning artifacts & validation

- Append newly introduced concepts to `docs/LEARNING_LOG.md` (concept, one-paragraph plain-English explanation, and a "look here in the code" pointer). Record non-obvious choices as ADRs in `docs/adr/` (capture the reasoning and tradeoff, not just the choice). Comments explain *why*, not *what*.
- Do not consider a Task complete until its stated validation criteria are met and verified. Where validation requires the User (external checks or human judgment), pause and request it rather than assuming success.

## Version control

- Base branch: `main` (deployable). One feature branch per dispatch unit off `main`; a batch of sequential Tasks for one Worker shares a branch. Branch names are `type/short-description` (`feat/`, `fix/`, `chore/`, `docs/`, `refactor/`, `test/`) describing the actual work — no APM identifiers in branch or commit names.
- Commits follow Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`); commit often. Do not commit build artifacts or generated files. Never push to the remote unless explicitly required (e.g. CI/CD deploy triggers) or asked.

} //APM_RULES
