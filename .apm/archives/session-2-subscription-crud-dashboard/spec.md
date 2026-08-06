---
title: SaaS Subscription Auditor — Session 2 (Subscription CRUD & Dashboard Core)
modified: Workspace section corrected after Task 2.1 findings (task-02-01.log.md) — Router v7 not v6, no shadcn `form` component in the Base UI preset, API money fields serialize as JSON strings. Modified by the Manager.
---

# APM Spec

## Overview

Session 2 of the SaaS Subscription Auditor builds a fully usable, manually-operated subscription tracker on top of the Session 1 foundation (deployed, authenticated, RLS-enforced full-stack app) — no AI features yet. It delivers a `subscriptions` data layer with per-user RLS, a subscriptions CRUD + analytics API, and a real dark-mode dashboard (tabbed shell with functional Overview, Subscription list, Subscription detail, and a partially-wired Settings tab), all bilingual (en/el). Success means: in **production on Azure**, a user can add / edit / cancel / delete their subscriptions through forms, see correct roll-up stats on the Overview (active-only, billing-cycle-normalized, grouped per currency), sort and filter the list, open any subscription's detail page, and edit their display name and language preference — with all data strictly per-user isolated (verified by a real-DB cross-user RLS-denial test) and the whole slice deployed and verified live.

## Workspace

Monorepo at repo root (`/Users/aristeidisskyllas/Summer work/Subscription-Auditor`). Single git repository; `main` is the deployable branch and merging to it triggers CI/CD deploys.

**Working targets (Workers modify these):**
- `backend/` — layered FastAPI (`app/routers/` → `app/services/` → `app/db/`, Pydantic `app/models/`, `app/deps.py`). Package/deps via `uv`; tests in `backend/tests/` (pytest).
- `frontend/` — React 19 + Vite + TS (strict), Tailwind v4 (CSS-first, no config file), shadcn/ui on the **Base UI** preset (this preset ships no generated `form` wrapper component — use the `field`/`separator` primitives for form UI instead), Router v7, TanStack Query, react-i18next (`src/i18n/locales/{en,el}.json`), feature-scoped `src/features/`, tests via Vitest. API money fields (Pydantic `Decimal`) serialize as JSON strings, not numbers — convert with `Number(...)` at display/format boundaries.
- `supabase/migrations/` — timestamped SQL migrations (Supabase CLI convention at repo root; `infra/supabase/` is a vestigial empty scaffold — do not use).
- `.github/workflows/` — `backend.yml` (OIDC → ACR → Container App) and `frontend.yml` (deploy token → Static Web Apps).

**Authoritative reference documents (read, do not duplicate):**
- `docs/APP_DESCRIPTION.md` — full product spec: §5.1 schema, §6 API surface, §2.7 dashboard tabs.
- `docs/ENGINEERING_STANDARDS.md` — four non-negotiable pillars (Scalability & Modularity, Security, Privacy, Educational tone).
- `docs/DECISIONS.md` — cross-session decisions (per-session migration convention; incremental-delivery strategy).
- `.apm/archives/session-1-foundation/session-summary.md` — what Session 1 delivered and its inherited constraints.

**Existing `CLAUDE.md`:** present at repo root with a populated `APM_RULES { … }` block (teaching cadence, external-platform steps, security & privacy, layering & config, learning artifacts, version control). Session-2 Rules update that block; content outside it is preserved.

**Environment note:** dev and prod Supabase are **fully independent projects** — every per-project setting (migrations, Site URL, providers) must be applied to each explicitly; Azure provisioning implies none of it.

---

> **Notes:** Dev + prod Supabase are independent — the prod migration is a distinct, explicit deploy step, not implied by CI. Rate limiting is in-memory per-process (inherited from S1); acceptable at Session-2 scale, no action needed this session. This session introduces the first `subscriptions` slice, which becomes the template every later session's tables/endpoints copy — keep the vertical-slice + strict-layering shape clean, as extensibility is an explicit User priority. Session 2 is a full deployable slice; the User has chosen to deploy to prod at session end (holistic prod-DoD verification is a natural Stage-boundary check for the Manager, mirroring S1).

## Data Model — `subscriptions` table (trimmed)

New migration under `supabase/migrations/` creating the `subscriptions` table. This is a **deliberately trimmed** subset of `docs/APP_DESCRIPTION.md` §5.1: only columns Session 2 uses are created now; deferred columns (`service_key`, `is_trackable_by_extension`, `tracked_domain`, `cost_per_hour_target`) are added by the sessions that use them (S4/S6) via their own migrations, per the per-session convention in `docs/DECISIONS.md`.

**Columns (Session 2):**

| Column | Type | Notes |
|---|---|---|
| `id` | `UUID PK DEFAULT gen_random_uuid()` | |
| `user_id` | `UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE` | RLS owning column |
| `name` | `TEXT NOT NULL` | e.g. "Claude Pro", "Netflix" |
| `category` | `TEXT` CHECK in enum below | nullable → treated as `other` in grouping |
| `price` | `NUMERIC(10,2) NOT NULL` | must be `>= 0` (CHECK) |
| `currency` | `TEXT NOT NULL DEFAULT 'USD'` | ISO 4217 3-letter |
| `billing_cycle` | `TEXT NOT NULL` CHECK in enum below | |
| `start_date` | `DATE NOT NULL` | |
| `next_renewal_date` | `DATE` | hybrid: user-supplied or backend-computed (see Renewal Date Semantics) |
| `status` | `TEXT NOT NULL DEFAULT 'active'` CHECK in enum below | |
| `cancellation_date` | `DATE` | set only when cancelled |
| `notes` | `TEXT` | free text; length-capped by Pydantic |
| `created_at` | `TIMESTAMPTZ DEFAULT now()` | |
| `updated_at` | `TIMESTAMPTZ DEFAULT now()` | |

**Enums (enforced as DB `CHECK` constraints AND Pydantic literals — defense in depth):**
- `category`: `ai_tool`, `streaming`, `productivity`, `cloud_storage`, `other`
- `billing_cycle`: `weekly`, `monthly`, `quarterly`, `yearly` (the spec's `custom` is **out of scope** this session — omit from the CHECK)
- `status`: `active`, `cancelled`, `paused`

**RLS (mandatory — the second security wall):** `ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;` plus four per-operation policies all keyed on `auth.uid() = user_id` (SELECT / INSERT with-check / UPDATE / DELETE), following the exact pattern established for `profiles` in `supabase/migrations/20260704152946_create_profiles_table.sql`.

**Indexes:** index on `(user_id, status)` and `(user_id, next_renewal_date)` to back the list-filter and upcoming-renewals query paths (no unbounded scans; every filter/sort path index-backed per `ENGINEERING_STANDARDS.md` §A).

**Applied to both dev and prod** Supabase projects (prod application is an explicit deploy step).

## Renewal Date Semantics

`next_renewal_date` is **hybrid**:
- If the client supplies `next_renewal_date` on create/update, that value is stored as-is (user intent wins).
- If omitted/null, the backend computes it: starting from `start_date`, advance by `billing_cycle` increments (`weekly` +7d, `monthly` +1 month, `quarterly` +3 months, `yearly` +1 year) until the date is strictly in the future (`> today`). Store the result.
- Computation lives in the **service layer** (pure, unit-testable), not in the router or SQL. Recompute on update when `start_date` or `billing_cycle` changes and the client did not explicitly provide a renewal date.

## Money Aggregation Semantics

Two distinct layers — the per-subscription view is literal; only roll-up totals normalize.

- **Per-subscription display is literal:** show exactly what was entered (e.g. "€15.99/month", "$120/year"). No transformation.
- **Roll-up totals normalize the billing cycle** to a **monthly-equivalent** amount: `weekly ×52/12`, `monthly ×1`, `quarterly ÷3`, `yearly ÷12`. Annualized projection = monthly-equivalent ×12.
- **Currency is grouped, never converted:** totals are reported per-currency (e.g. `{ "EUR": 40.00, "USD": 25.00 }`). **No FX rates, no external FX API** this session.
- **Active-only basis:** only `status = 'active'` subscriptions contribute to monthly burn, annualized projection, top expenses, and spend-by-category. `cancelled` and `paused` are excluded from all spend aggregates but remain visible in the list with a status badge.
- Normalization math lives in a **shared, unit-tested helper** (backend service layer authoritative; a frontend util may mirror it for any client-side display, kept in parity).

## API Surface (Session 2)

All under `/api/v1`, Bearer-JWT auth via the existing `get_current_claims` dependency, every data query through `rls_connection(claims)`. Contracts layer onto `docs/APP_DESCRIPTION.md §6.2/§6.9`; Session-2 specifics pinned here.

**Subscriptions (`app/routers/subscriptions.py`):**
- `GET /subscriptions` — list the caller's subscriptions. **Paginated** (`limit` default 50, max 100; `offset` or cursor). Query filters: `status`, `category`; sort: `sort_by` in {`name`, `price`, `next_renewal_date`, `created_at`} + `order` in {`asc`,`desc`}. Returns items + total count (or next cursor). No unbounded `SELECT *`.
- `POST /subscriptions` — create. Body validated by Pydantic (enums as `Literal`, `price >= 0`, length caps, ISO-date parsing). `user_id` is taken from JWT claims, **never** from the body.
- `GET /subscriptions/{id}` — detail. RLS returns no row for a non-owner → 404.
- `PATCH /subscriptions/{id}` — partial update (all fields optional; same validation).
- `DELETE /subscriptions/{id}` — **hard delete** (row removed).
- `POST /subscriptions/{id}/cancel` — **soft cancel**: sets `status='cancelled'` and `cancellation_date` (defaults to today; optional body override). Row retained.

**Analytics (`app/routers/subscriptions.py` or `app/routers/analytics.py`):**
- `GET /subscriptions/analytics` (or `GET /analytics/overview`) — returns the Overview payload computed **server-side** (SQL aggregation in the `db/` layer where possible, assembled in the service): monthly-equivalent burn per currency, annualized per currency, top expenses (active, normalized, sorted desc, capped e.g. top 5), upcoming renewals in the next 30 days (active, sorted by date), spend-by-category (active, monthly-equivalent, per currency). Active-only per Money Aggregation Semantics.

**Profile (`app/routers/me.py` — extend existing):**
- `PATCH /me` — update `display_name` and/or `preferred_language` (`Literal['auto','en','el']`). Reuses the `/me` slice; writes through `rls_connection`.

**Models:** Pydantic request/response schemas in `app/models/subscription.py` (and analytics response model). Zod schemas on the frontend mirror these for form UX only — the backend re-validates (trust boundary).

## Frontend Structure

**Visual/aesthetic UX is decided collaboratively with the User during development — not pre-specified here.** This section fixes only the *structural* UX that changes what gets built (modal vs page, table vs cards, which tabs are functional, active-only/literal data rules). The *visual* decisions — navigation style (sidebar vs top-nav), Overview layout and what it leads with, spend-by-category chart type, color/styling within the dark-mode-first standard, card arrangement, empty-state visuals, micro-copy — are **explicitly left open for the Frontend Agent to decide interactively with the User at build time.** Required collaboration pattern for all Stage 2 UI work: build in small increments, and at each meaningful visual choice **pause and ask the User** — present concrete options (2–3 alternatives, a quick mockup/sketch, or a rendered increment to look at) and let the User pick before proceeding, rather than deciding aesthetics unilaterally. Lean on the `dataviz` and `artifact-design` skills to generate good options to choose between. The User wants to *see* choices and react to them.

- **Dashboard shell** replaces the current flat `src/routes/Dashboard.tsx`: a persistent layout with tab navigation (sidebar or top-nav, dark-mode default). Tabs: **Overview**, **Subscriptions**, **Detail** (per-subscription route), **Settings** — functional this session. **Reports** and **Chat** appear as visible but clearly-placeholder tabs (wired in S3/S4). Feature-scoped under `src/features/` (e.g. `features/subscriptions/`, `features/dashboard/`, `features/settings/`).
- **Overview tab:** monthly burn (per currency), annualized projection, upcoming renewals (next 30 days), top expenses, spend-by-category chart — **Recharts** (first use in the project), consuming the analytics endpoint via TanStack Query.
- **Subscription list:** sortable, filterable table (shadcn `table`) with status badges (`badge`); row actions (edit / cancel / delete) and an "Add" button.
- **Add/edit:** **modal Dialog** (shadcn `dialog`) containing a react-hook-form + Zod form (shadcn `form`, `select`, `input`); used for both create and edit. Delete and cancel are confirmed actions.
- **Subscription detail:** real info + edit / cancel / delete actions; **explicit placeholders** for usage chart, usage heatmap, and cost-per-hour (these require browser-extension data from Session 6 — render "available after usage tracking is set up"-style empty states, not fake data).
- **Settings:** profile display-name + language preference **wired** to `PATCH /me` (react-hook-form + Zod, TanStack Query mutation). Notification preferences render as **inert UI** (backend arrives in S5) — visually present, clearly not-yet-active.
- **New shadcn/Base UI components to add:** `table`, `dialog`, `form`, `select`, `badge`, `card` (add via the project's established shadcn/Base UI setup; new components must use the Base UI `render`-prop API, not Radix).
- **State/data:** server state via TanStack Query only (no raw `useEffect`+fetch); calls go through `src/lib/api.ts::apiFetch` with the session access token; query hooks follow the `src/hooks/useMe.ts` pattern.

## Localization

All new UI strings keyed in both `src/i18n/locales/en.json` and `el.json` (no hardcoded copy). Numbers, dates, and currencies formatted per active language via the `Intl` API (`Intl.NumberFormat` with `style:'currency'` + the subscription's currency; `Intl.DateTimeFormat` for dates). Currency selection in the form is a curated dropdown of ISO 4217 codes (at minimum USD, EUR, GBP; extend as convenient) — not free text — to keep the per-currency grouping clean.

## Quality & Delivery Constraints

- **Testing bar (matches Session 1):** backend pytest covering subscription CRUD (create/read/update/cancel/delete, validation rejections, pagination/filter/sort) **and a real-DB cross-user RLS-denial test** for `subscriptions` (a second user cannot read/modify the first's rows) — non-negotiable. Frontend Vitest on the money-normalization util and form validation. Analytics correctness covered by service-layer unit tests (cycle normalization, active-only, per-currency grouping).
- **Security (always-on, per `ENGINEERING_STANDARDS.md` §B):** Pydantic validation on every input; parameterized asyncpg only (no string-built SQL); `user_id` never trusted from request bodies; RLS as the second wall; existing security-headers + rate-limit middleware remain in force.
- **Definition of done:** the slice is deployed to Azure prod, the migration is applied to **prod** Supabase, and the end-to-end flow is verified live (create → see on Overview → edit → cancel → delete; per-user isolation holds). Unauthenticated access remains blocked.
- **Educational cadence** (per `ENGINEERING_STANDARDS.md` §D and `CLAUDE.md`): explain-before-build and stop-and-teach at each first-use concept this session — notably Recharts, react-hook-form + Zod, shadcn Dialog/Table (Base UI render-prop API), pagination, SQL aggregation, and `Intl` localization.
