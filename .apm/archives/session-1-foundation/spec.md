---
title: SaaS Subscription Auditor — Session 1 (Foundation & Deployment Pipeline)
modified: Spec creation by the Planner.
---

# APM Spec

## Overview

SaaS Subscription Auditor is a full-stack, AI-native web app for tracking, analyzing, and optimizing recurring subscriptions; it is built across seven independently deployable sessions (see `docs/APM_SESSIONS.md`). This Spec scopes **Session 1 — Foundation & Deployment Pipeline** only: a thin but production-real vertical slice that establishes the monorepo, backend and frontend skeletons, a minimal authenticated database, and a working Azure deploy pipeline. Success = a user can sign up, verify email, log in via email/password **and** Google OAuth, reset a password, stay logged in ("remember me"), log out, and see their own email rendered on a protected page **running in production on Azure**. The session deliberately ships a small feature surface but a complete, secure, deployable foundation that every later session builds on.

## Workspace

- **Single Git monorepo** at the workspace root; current branch `main` (deployable). No application code yet — only documentation and APM scaffolding have been committed.
- **Authoritative reference documents** (read-only source of truth; reference by path/section, do not duplicate):
  - `docs/APP_DESCRIPTION.md` — full project spec: functional pillars, architecture, locked stack (§4), DB schema (§5), API surface (§6), repo structure (§7), local dev (§8), deployment (§9), security/privacy (§10).
  - `docs/APM_SESSIONS.md` — the 7-session breakdown; Session 1 scope is the basis for this Spec.
  - `docs/ENGINEERING_STANDARDS.md` — four non-negotiable pillars (A Scalability/Modularity, B Security, C Privacy/GDPR, D Educational) inherited by every session.
  - `docs/DECISIONS.md` — cross-session decisions (e.g., MVP-through-Session-3 soft target).
- **Target repository layout** to scaffold this session: `frontend/`, `backend/`, `extension/` (placeholder only), `infra/` (`infra/azure/`, `infra/supabase/`), `.github/workflows/`, plus root `docker-compose.yml`, `.env.example` files. Follows `docs/APP_DESCRIPTION.md` §7.
- **Existing `CLAUDE.md`** at root holds persistent project context and non-negotiables; it is preserved and will receive an appended `APM_RULES` block. External accounts: **Azure subscription exists**; Supabase projects, Google OAuth client, and Groq key do **not** exist yet.

---

> **Notes:**
> - **Worker model preference:** Workers should use **Fable** wherever it can do the job, falling back to **Opus**, then **Sonnet 5**. Apply when assigning/dispatching work.
> - **External-platform steps are User-driven and guided.** Creating Supabase projects, the Google OAuth client, and all Azure resource provisioning require the User's authenticated console/CLI actions. Workers prepare exact commands/instructions and teach live; the User executes. These Tasks pause for User action and cannot be fully autonomously validated.
> - **Minimal-schema divergence:** Session 1 creates only the `profiles` table, diverging from `docs/APM_SESSIONS.md` ("all tables from spec §5 now"). This was a deliberate User decision (the data model may change before later sessions). Worth recording in `docs/DECISIONS.md` during this session.
> - **Security is non-deferrable on anything that ships live** (per `docs/ENGINEERING_STANDARDS.md` §B and `docs/DECISIONS.md`). The auth/JWT/RLS/security-header baseline below must be complete before the deploy is considered done.

## Session Scope & Success Criteria

Session 1 delivers the foundation defined in `docs/APM_SESSIONS.md` "Session 1 — Foundation & Deployment Pipeline". In scope:

- Monorepo scaffold + local Docker Compose (frontend + backend) per `docs/APP_DESCRIPTION.md` §7, §8.2.
- Backend skeleton (FastAPI + Uvicorn), health/readiness, Supabase JWT verification, asyncpg pool + RLS-enforcing data layer.
- Frontend skeleton (React + Vite + TS + Tailwind + shadcn/ui, dark mode, routing, i18n scaffold), Supabase Auth flows, protected route guard, "Hello {user}" page.
- Minimal database (`profiles` only) + RLS + Supabase CLI migration workflow across dev/prod projects.
- Azure provisioning (documented `az` CLI, User-driven) + GitHub Actions CI/CD + first end-to-end production deploy.
- Full developer quality baseline (formatters, linters, type-checking, pre-commit hooks, small CI test suites).

**Definition of done:** In the deployed production app, a user completes signup → email verification → login (email/password and Google) → sees their email on a protected page; password reset and logout work; unauthenticated access to the protected page is blocked. CI builds/tests/deploys both frontend and backend on merge to `main`.

## Authentication & Authorization

Auth is handled by **Supabase Auth** on the frontend; the backend only **verifies** JWTs. Requirements per `docs/APP_DESCRIPTION.md` §2.8 and §10.1:

- Flows: email/password signup, **email verification required**, email/password login, Google OAuth ("Sign in with Google"), password reset (email), "remember me" (persistent refresh-token session), logout (revokes refresh token).
- **Authorization is Bearer JWT in the `Authorization` header only** — never cookies (CSRF-immune by construction; `docs/ENGINEERING_STANDARDS.md` §B/CSRF).
- Backend verifies every protected request's JWT against Supabase JWKS and extracts `user_id` via a FastAPI dependency.
- **RLS is the enforcement mechanism** for data scoping; the backend never trusts client-supplied identity beyond the verified JWT.
- Google OAuth client (Google Cloud) and Supabase Auth provider configuration are **User-driven guided setup** steps.

## Backend Architecture & Data Layer

- **Strict layering, no leakage:** `routers/` (HTTP only) → `services/` (business logic) → `db/` (data access), per `docs/ENGINEERING_STANDARDS.md` §A. Structure follows `docs/APP_DESCRIPTION.md` §7.
- **Stateless backend** — no in-memory per-user state (horizontal scaling on Container Apps).
- **Data-layer pattern (foundational for all sessions):** the backend owns a single **asyncpg connection pool**. Each authenticated request runs its DB work inside a transaction that sets, via `SET LOCAL`, `request.jwt.claims` (the verified JWT claims JSON) and `role = 'authenticated'`, so Postgres RLS policies keyed on `auth.uid()` enforce per-user scoping automatically. The **service-role/direct connection bypassing RLS is reserved for system operations only** (none required in Session 1). This per-request transaction wrapper is the security boundary and must be implemented and tested with both authorized and cross-user-denied cases.
- **Endpoints this session:** `GET /health` (liveness), `GET /ready` (readiness: DB ping), and a protected `GET /me`-style endpoint returning the authenticated user's profile/email. Full API surface is `docs/APP_DESCRIPTION.md` §6; only the above are built now.
- **Packaging:** `uv` with `pyproject.toml` + `uv.lock`.

## Database & Migrations

- **Two Supabase projects:** `subscription-auditor-dev` (local dev) and `subscription-auditor-prod` (deployed), per `docs/APP_DESCRIPTION.md` §8.1. Both User-created (guided).
- **Minimal schema for Session 1:** only `profiles` (columns per `docs/APP_DESCRIPTION.md` §5.1 `profiles`), with **RLS enabled** and per-operation policies (pattern in §5.2), plus an **auto-create-profile-on-signup** mechanism (Postgres trigger on `auth.users` insert, or equivalent) so a profile row exists after signup. All other §5 tables are deferred to their sessions.
- **Migrations via the Supabase CLI** — versioned migration files, applied to dev first then prod. This is the standard workflow for every later session's schema additions. Migration SQL lives under the repo (e.g., `infra/supabase/` and/or `supabase/migrations/` per CLI convention).

## Frontend Foundation

Per `docs/APP_DESCRIPTION.md` §2.7, §4.1, §12.5:

- React 18 + Vite + TypeScript (`strict: true`), Tailwind CSS, **shadcn/ui**, **dark mode as the default/primary target**, lucide-react icons.
- React Router v6 routing shell; **protected-route guard** that redirects unauthenticated users away from protected pages.
- Supabase Auth client (`@supabase/supabase-js`) wiring for all flows above; session persistence for "remember me".
- **i18n scaffold** (`react-i18next`, `en` + `el` locales) with UI strings keyed — full localization coverage grows in later sessions; the scaffold and keying discipline start now.
- TanStack Query set up as the server-state mechanism (no raw `useEffect + fetch` for data), even though data needs are minimal this session.
- The single protected "Hello {user}" page renders the authenticated user's email fetched from the backend.

## Infrastructure & Deployment

Per `docs/APP_DESCRIPTION.md` §9:

- **Provisioning via documented `az` CLI**, authored by a Worker and **run by the User** with live explanation; commands + rationale captured in `infra/azure/README.md` for reproducibility (dev + prod). Bicep is deferred.
- Azure resources: **Container Apps** (backend, consumption plan, scale-to-zero `minReplicas: 0`), **Container Registry** (Basic), **Static Web Apps** (frontend), **Key Vault** (backend secrets), **Application Insights** (**provisioned only — structured-log instrumentation is deferred to Session 7**).
- **Secrets:** `.env` files locally (gitignored; `.env.example` committed as templates per `docs/APP_DESCRIPTION.md` §8.3); in production, backend secrets come from **Key Vault** referenced by the Container App. Frontend build-time env vars via GitHub Actions secrets.
- **CI/CD (GitHub Actions):** `backend.yml` (test → build Docker → push to ACR → update Container App revision) and `frontend.yml` (lint → build → deploy to Static Web Apps), per `docs/APP_DESCRIPTION.md` §9.2. `extension.yml` is deferred to Session 6.
- **SSE ingress no-buffering** config (§9.3) is not needed this session (no streaming yet) — deferred to Session 3.

## Developer Quality Baseline

Established now so all later sessions inherit clean guardrails (per `docs/APP_DESCRIPTION.md` §12 and User decision):

- **Formatters/linters:** `black` + `ruff` (Python); `prettier` + `eslint` with `@typescript-eslint` (TS). `strict: true` TS; `mypy` in loose mode on the backend.
- **Pre-commit framework** running black, ruff, prettier, eslint, and **basic secret scanning** (`docs/APP_DESCRIPTION.md` §12.4).
- **Tests wired into CI:** backend `pytest` covering `/health` and the JWT-verification dependency (valid-token and invalid/expired-token paths); frontend **Vitest** harness with at least a smoke test. Test suites are intentionally small but real, and gate CI.
- **Dependency hygiene:** pinned dependencies; lockfiles committed (`uv.lock`, `package-lock.json`).

## Security & Privacy Baseline (Session 1 subset)

The applicable, non-deferrable subset of `docs/ENGINEERING_STANDARDS.md` §B/§C for what ships live this session:

- **JWT verification** against Supabase JWKS on every protected endpoint; generic auth error messages (no user-enumeration oracle).
- **RLS on `profiles`** as the data-scoping wall (see data-layer pattern above); parameterized asyncpg queries only — never string-built SQL.
- **Security headers on every response:** CSP (strict; tightened as the frontend surface grows), HSTS, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`.
- **Rate limiting:** per-IP limiting on auth-adjacent endpoints against brute force (chat/extension/LLM caps arrive with their sessions).
- **Secrets discipline:** nothing secret in the repo; `.env` gitignored; Key Vault in prod; least-privilege Supabase keys (service-role only where a system op genuinely requires bypassing RLS — not needed in Session 1 request paths).
- **Privacy:** no PII in logs; a Privacy Policy and full data export/deletion are later-session deliverables (§C) — not built now, but the schema's `ON DELETE CASCADE` foundations are respected. Client storage this session is strictly-necessary only (auth token, language) — no consent banner required (§C).

## Deferred / Out of Scope for Session 1

Explicitly not built this session (pulled in by their own sessions; do not implement early):

- All §5 tables other than `profiles` (added per session that first needs them).
- Groq/LLM, chat, SSE streaming, tools registry — Session 3.
- Application Insights **instrumentation** (structured logs/traces) — Session 7 (resource is provisioned now).
- Scheduler / APScheduler and its single-owner concurrency mechanism — resolve before Session 5.
- Web Push, invoice import, reports/insights, browser extension, `extension.yml` — Sessions 4–6.
- Data export / account deletion / Privacy Policy page — Session 7 (§C).
- Bicep IaC, light-mode polish, full i18n string coverage.
