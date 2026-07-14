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
- Ship a Privacy Policy disclosing data collected + sub-processors (Supabase, Google/Gemini, Groq, Azure). Explicit
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

## Frontend conventions (any Task building UI)

- **Server state via TanStack Query only** — never raw `useEffect` + `fetch` for data fetching/mutation. Follow the existing hook pattern in `src/hooks/useMe.ts`; all backend calls go through `src/lib/api.ts::apiFetch` with the session access token.
- **Every user-facing string is i18n-keyed in both `en` and `el`** (`src/i18n/locales/`) — no hardcoded copy. Numbers, dates, and currencies are formatted with the `Intl` API keyed to the active language (never hand-rolled formatting).
- **New shadcn/ui components use the Base UI preset** (`render`-prop API), not Radix — match the project's established shadcn setup.
- Dark mode is the default and primary design target; forms use `react-hook-form` + `zod` (Zod is UX-only validation — the backend re-validates).

## UX collaboration (any Task making visual/aesthetic choices)

- **Structural UX** (page vs modal, table vs cards, which views are functional) is fixed by the Task's requirements — implement as specified.
- **Visual/aesthetic UX** (layout, navigation style, chart type, color/styling, arrangement, empty-state look, micro-copy) is **decided interactively with the User.** Build in small increments and, at each meaningful visual choice, **pause and present the User concrete options** — 2–3 alternatives, a quick mockup/sketch, or a rendered increment to look at — and let them choose before proceeding. Do not settle aesthetics unilaterally. Use the `dataviz` and `artifact-design` skills to generate strong options to choose between.
- **Avoid the generic "AI-generated" look.** Steer clear of the tells — sparkle/✨ motifs and decorative gradient hero blobs, oversized centered empty-state heroes, redundant labels (a card title repeating the page heading), emoji as UI chrome, purple-gradient defaults, and filler copy. Prefer restrained, purposeful, real-product styling: use each surface's own domain icon over decorative ones, keep empty/placeholder states understated, and don't add ornament that carries no information. When in doubt, less chrome.

## Per-user isolation testing (any Task adding a user-scoped table)

- When introducing a table scoped by `user_id`, prove isolation with a **real-DB cross-user RLS-denial test** (a second user cannot read or modify the first user's rows), following the existing pattern in `backend/tests/test_rls.py`. This is not optional — RLS is the second security wall and must be verified, not assumed.

## AI chatbot & LLM integration (any Task on the chat/LLM surface)

- **Route every model access through `backend/app/services/llm.py`.** Never call a provider SDK or hardcode a provider/model ID anywhere else; provider, model, and key come from environment. Add new capabilities by **registering a tool in the tool registry** — never grow the chat loop with a hardcoded tool switch (concrete application of the "LLM tools live in a registry" and "config from environment" non-negotiables above).
- **On this surface the Secure non-negotiables apply with full force.** Validate every LLM tool-call payload against its Pydantic schema **before** execution — a malformed call returns a clean error back to the model, never a partial or raw execution; never let raw model output trigger a privileged action or reach the DB unvalidated; render any model- or DB-sourced content with **no raw HTML** — sanitize markdown via DOMPurify with a tag allowlist and render structured chart/table payloads through typed components, never `dangerouslySetInnerHTML`.
- **Ground every displayed figure in real data.** Numbers and rows shown in chat (charts, tables, analytics answers) must come from tool results computed against the database — never from values the model produced free-form.
- **Never log message content or prompt/response text** (the "no PII/message content in logs" rule, with force here); per-call token-usage counts are fine.

} //APM_RULES
