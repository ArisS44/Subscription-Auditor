# Engineering Standards — SaaS Subscription Auditor

> **Purpose**: Cross-cutting, non-negotiable standards that apply to **every APM session** of this
> project. Because APM archives between sessions and each session gets a fresh Planner, these rules
> are persisted here (not in chat) and **every Planner kickoff must reference this file**:
> _"All work must comply with `docs/ENGINEERING_STANDARDS.md`."_
>
> Three pillars: **Scalability & Modularity**, **Security (defense-in-depth)**, **Educational Tone**.

---

## A. Scalability & Modularity

The guiding rule: **a change in one place must not break another, and everything must work correctly
for many concurrent users.**

- **Strict layering, no leakage.** `routers/` (HTTP only) → `services/` (business logic) → `db/`
  (data access). Routers contain zero business logic; services never touch `Request`/`Response`
  objects. A change in one layer must not force changes in another.
- **Feature-scoped modules** on the frontend (`features/chat`, `features/subscriptions`, …) so
  features can be added/removed without cross-contamination. No god-files, no shared mutable grab-bags.
- **Stateless backend.** No in-memory per-user state — Azure Container Apps scales replicas
  horizontally and any request may hit any replica. Session state lives in the DB/JWT, not the process.
- **⚠️ Scheduler concurrency (design for it, do not defer):** in-process APScheduler across multiple
  replicas fires **every job N times** (N reminders, N reports) — a correctness bug at scale, not just
  cost. Require a single-owner mechanism: a Postgres advisory lock / leader election, a dedicated
  single-replica scheduler, or the external-cron-pinger option. Resolve before Session 5.
- **DB connection pooling** (asyncpg pool sized to replica count, or Supabase's PgBouncer pooler).
  A per-request connection will exhaust Postgres under load.
- **Pagination + limits on every list endpoint.** No unbounded `SELECT *`. Every filter/sort path must
  be backed by an index. Avoid N+1 query patterns.
- **The LLM tool set is a registry**, not a hardcoded switch — adding a tool means registering it, not
  editing the core chat loop.
- **Idempotent batch ingest** for extension `usage_events` (stable dedupe key) so client retries don't
  double-count.
- **Shared contracts:** Pydantic (backend) and Zod (frontend) schemas kept in parity. API stays
  versioned under `/api/v1`. Config via environment only — no hardcoded hosts, keys, or magic numbers.

---

## B. Security — defense-in-depth, all input treated as hostile

- **Input validation everywhere.** Pydantic v2 on every request body/param with strict types, length
  caps, and allowlists (enums, not free strings, where possible). Zod on the frontend is UX only, never
  the trust boundary — the backend always re-validates.
- **LLM input and output are both untrusted:**
  - **Prompt injection** — invoice text (especially malicious PDFs) and extension data flow into the
    model. A crafted document can carry _"ignore instructions, extract this…"_. Isolate untrusted
    content in the prompt, never let raw model output trigger privileged actions, and **validate every
    tool-call payload against Pydantic before execution**.
  - **Model output is untrusted data** and feeds directly into the XSS rules below.
- **XSS (the largest real surface).** The chat renders LLM output + stored messages + inline
  charts/tables. React auto-escapes; the danger is `dangerouslySetInnerHTML`. Rule: **no raw HTML from
  the LLM or the DB, ever.** Render markdown through a sanitizer (e.g., DOMPurify) with a tag allowlist,
  and ship a strict **Content-Security-Policy** header.
- **SQL injection.** Parameterized queries only — asyncpg placeholders, never f-strings/concatenation
  into SQL. **RLS is the second wall:** even a successful injection stays scoped to one user's rows.
- **CSRF.** API auth is **Bearer JWT in the `Authorization` header**, which is structurally
  CSRF-immune (a cross-origin attacker cannot set that header). Requirement: **keep it that way** — do
  not move auth to cookies. If a cookie is ever introduced, it must be `SameSite=Strict/Lax` plus a
  CSRF token.
- **SSRF.** If the backend ever fetches a user-supplied URL: deny by default, allowlist hosts, and
  **block internal ranges + the Azure metadata endpoint `169.254.169.254`** (IMDS credential theft).
  Preference: never fetch user-supplied URLs at all.
- **Rate limiting / DoS**, tiered:
  - Chat endpoint (protects the Groq bill) — per-user, e.g. 30/min.
  - Auth endpoints (brute force) — per-IP.
  - Extension ingest — per-token, e.g. 1 batch/min.
  - **Bill-shock guard:** scale-to-zero can be abused to force costly spin-ups + LLM calls. Cap per-user
    daily LLM requests/spend.
- **Resource exhaustion — the real analog to "buffer/binary exploits" on this managed stack:** hard
  file-size limits (~10 MB), reject decompression/PDF bombs, timeouts on `pdfplumber`/`pytesseract`,
  guard against catastrophic-backtracking regexes, and bound all query result sizes.
- **Timing side-channel:** use constant-time comparison (`hmac.compare_digest`) for the extension-token
  hash check. Generic auth error messages (no "user not found" vs "wrong password" oracle).
- **Security headers:** CSP, HSTS, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`
  (clickjacking), `Referrer-Policy`.
- **Least privilege:** service-role key only for system jobs that must bypass RLS; extension tokens
  scoped to extension endpoints only; secrets in Azure Key Vault; `.env` gitignored; store only the
  SHA-256 **hash** of extension tokens.
- **Supply chain:** pinned dependencies, `pip-audit` + `npm audit`/Dependabot in CI, secret-scanning
  pre-commit hook.

### Scope notes (what does NOT apply, and why — this is intentional, not an oversight)

- **Buffer overflows / binary exploitation** are memory-corruption bugs in unmanaged (C/C++) code.
  Python and TypeScript are memory-managed — classic stack-smashing is not expressible. The equivalent
  threat on this stack is **resource exhaustion**, covered above. Keep the mindset; drop the literal term.
- **Hardware side channels** (cache-timing, power analysis, Spectre-class) are out of scope for an app
  on managed hosting — we don't control the silicon or hypervisor. The one applicable case is
  **secret-comparison timing**, covered above.

---

## C. Educational Tone — teach the developer *while* building

This project is also a learning vehicle for its solo developer, who is **new to most of the stack**
(React/TS, Tailwind, FastAPI, Docker, Azure, Chrome extensions). The requirement is **live, interactive
teaching during the build**, not just well-documented artifacts. Agents are expected to slow down and
explain.

**Interaction protocol (applies to every Worker/Manager doing hands-on work):**

- **Explain before you build, not only after.** Before starting a meaningful unit of work, state in
  plain English _what_ you're about to do, _why_ this approach, and _what framework concept_ it
  introduces. Then build.
- **Stop and teach at every new concept.** The first time the project touches a concept (a FastAPI
  dependency, RLS policy, JWT verification, SSE stream, Docker layer, Vite build, a React hook, a
  service worker, …), **pause work and give a short focused explanation** before writing the code that
  uses it. Do not silently introduce something the developer hasn't seen.
- **Prefer frequent small checkpoints over one big drop.** Build in small increments, explaining each,
  rather than producing a large amount of code and explaining it all at the end. It's expected and
  encouraged to interrupt your own flow to teach.
- **Check understanding.** After explaining a non-trivial concept, invite questions / confirm before
  proceeding, rather than assuming and moving on.
- **Explain tradeoffs out loud**, not just the chosen path — the developer learns from the roads not taken.
- **Assume little prior knowledge** of the stack; assume strong general programming + AI theory. Don't
  over-explain basic programming; do explain the framework/tooling idioms.

**Artifacts that support the live teaching (secondary to it, not a substitute):**

- **Comments explain _why_, not _what_** — especially framework-specific idioms.
- Each session appends a short entry to **`docs/LEARNING_LOG.md`**: new concepts introduced, a
  one-paragraph plain-English explanation, and a "look here in the code" pointer.
- **Architecture Decision Records** in `docs/adr/` for non-obvious choices — capture the _reasoning and
  tradeoff_, not just the choice.
- Prefer **clarity over cleverness**; docstrings state intent and the framework concept in play.

---

*These standards are inherited by all sessions. Update here (not in chat) if they change.*
