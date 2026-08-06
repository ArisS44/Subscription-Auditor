---
title: SaaS Subscription Auditor — Session 4: Reminders & Guidance
modified: Acceptance criterion 7 corrected — the onboarding notification opt-in is no longer gated on at least one subscription existing (User decision 2026-07-30, reversing a Task 2.4 choice). Added category-inference correction to Subscription Guidance after a User-reported defect on chat-created subscriptions. Modified by the Manager.
---

# APM Spec

## Overview

Session 4 of the SaaS Subscription Auditor is a full-stack feature slice that makes the application reach
*out* to its users for the first time, and teaches the Apollon assistant to advise on cancelling a
subscription rather than only tracking one. It delivers Web Push renewal reminders driven by an
externally-triggered scheduled job, plus a curated subscription-guidance knowledge base surfaced through
the existing chat tool registry, and corrects a live first-login defect in the onboarding flow. The core
problem it solves is that a subscription tracker nobody opens is a spreadsheet — the reminder is the
feature that converts passive record-keeping into an active product. Success means a real push
notification arriving on a real device ahead of a real renewal (honouring both per-user and
per-subscription lead times, and suppressed for cancelled or paused subscriptions), the assistant
answering "how do I cancel Netflix" from verified curated data, and new users landing directly in the
onboarding wizard exactly once.

## Workspace

Single Git repository, monorepo layout, at `/Users/aristeidisskyllas/Summer work/Subscription-Auditor`.
Branch `main` is deployable; **pushing to `main` triggers the production deploy workflows.**

| Path | Role |
|---|---|
| `backend/` | **Working target.** FastAPI + Pydantic v2 + asyncpg. Strict `routers/` → `services/` → `db/` layering. |
| `frontend/` | **Working target.** React 18 + Vite + TypeScript + Tailwind + shadcn/ui + Recharts + TanStack Query. |
| `supabase/migrations/` | **Working target.** Versioned SQL migrations (3 exist today). |
| `.github/workflows/` | **Working target.** Backend and frontend deploy workflows; a scheduled workflow is added this session. |
| `extension/` | Untouched this session — scaffold only, built in Session 6. |
| `docs/` | Authoritative reference (see below). |
| `.apm/archives/` | Read-only history of Sessions 1–3. |

Authoritative documents, to be referenced rather than duplicated:

- `docs/APP_DESCRIPTION.md` — full project specification. §2.5 (Web Push), §5 (data model), §6.7 (push API
  surface), §9.4 (scheduled jobs) are directly relevant.
- `docs/APM_SESSIONS.md` — roadmap. **Revised 2026-07-22**; the Session 4 section reflects this session.
- `docs/ENGINEERING_STANDARDS.md` — non-negotiable standards, inherited by all sessions.
- `docs/DECISIONS.md` — cross-session decisions. The four 2026-07-22 entries govern this session.
- `docs/adr/` — three existing ADRs; ADR 0003 (lazy-refresh FX cache, no scheduler) is the precedent this
  session's scheduler decision builds on and partially supersedes.

`CLAUDE.md` exists at the workspace root and is authoritative. It carries four non-negotiable pillars
(scalability/modularity, security, privacy/GDPR, educational tone) plus an `APM_RULES` block containing
teaching cadence, external-platform step handling, security and privacy rules, layering rules, learning
artifacts, version control, frontend conventions, UX collaboration standards, per-user isolation testing,
and AI/LLM integration rules. Existing content is preserved; this session's Rules are added into the
`APM_RULES` block.

---

> **Notes:**
> - The Supabase CLI is currently linked to **prod** (`ylwjevannrlsauegwbas`), left that way at the end of
>   Session 3. Any dev migration work requires `supabase link --project-ref zocfhyysnvptxktqezfk` first,
>   **and** a valid `supabase login` — the relink alone does not authenticate the Management API push. This
>   has cost time in every session so far.
> - Dev and prod are independent Supabase projects. Every migration this session must be applied to both.
> - The backend pytest suite intermittently fails 1–3 live-DB tests against shared dev Supabase (Auth Admin
>   rate limiting / connection-pooler drops under back-to-back test-user creation). A different test fails
>   each run. Confirm by isolated rerun before treating it as a regression.
> - `npm run build` (`tsc -b`) type-checks test files in ways `npm run test` does not; this has caused a
>   prod-only CI failure once. This is already a Rule, noted here because it affects deploy risk.
> - The User verifies personally and directly rather than accepting green tests — Session 3's record shows
>   several real defects caught only by live use. Expect and plan for hands-on verification checkpoints.
> - Several deliverables this session **cannot be validated from the development environment at all** (Web
>   Push requires HTTPS and a real browser subscription). Tasks are written to pause for User execution
>   where this applies.
> - `backend/scripts/chat_repl.py` is an untracked throwaway REPL harness from Session 3, deliberately
>   never committed. Useful for live tool testing; safe to ignore or delete.

## Session Scope and Boundaries

This session's scope was resequenced from the original roadmap before work began. The rationale is
recorded in `docs/DECISIONS.md` (2026-07-22, "Roadmap resequenced"); the short form is that the original
Session 4 was half-blocked on usage data that does not exist until Session 6, while notification work has
been fully unblocked since Session 1.

**In scope:**

1. Onboarding first-login defect correction.
2. Scheduled-work foundation: externally-triggered job endpoint, delivery ledger, service-role boundary.
3. Web Push infrastructure: VAPID, per-device subscription storage, send pipeline, dead-subscription pruning.
4. Renewal reminder engine: due detection, lead-time resolution, suppression rules, bilingual copy.
5. Frontend delivery surface: service worker, PWA manifest, permission opt-in, Settings wiring, per-subscription lead-time field.
6. Subscription guidance: `service_guides` table and seed, `get_subscription_guide` tool, prompt adjustment.

**Explicitly out of scope** — these are excluded by decision, not by oversight. Do not build them:

| Excluded | Reason | Lands in |
|---|---|---|
| Monthly reports, `/reports`, Reports tab | Pairs with the monthly-review notification | Session 5 |
| Monthly review notification | Would point at a report that does not exist yet | Session 5 |
| Invoice import (PDF/OCR/extraction) | Independent slice | Session 5 |
| `get_recommendation` ("should I keep X?") | Needs usage data to answer meaningfully | Session 6 |
| `cost_per_hour_target` budget thresholds | A threshold on a metric that cannot yet be computed | Session 6 |
| Cost-per-hour, usage heatmap, usage charts | No usage data exists until the extension ships | Session 6 |
| Renewal history on the detail view | No historical snapshot mechanism exists; unscoped work | Deferred, no session |
| Email reminder delivery | Blocked on a verified sending domain | Session 7 |
| Custom domain, SMTP | Already scheduled | Session 7 |

The three `UsagePlaceholder` cards in `frontend/src/features/subscriptions/SubscriptionDetail.tsx` stay as
they are. They are honest placeholders and must not be filled with fabricated or derived-looking numbers.

## Scheduled Work Architecture

This is the project's first backend work not initiated by a user request. The design resolves the
scheduler single-owner question that `docs/ENGINEERING_STANDARDS.md` §A flagged as "design for it, do not
defer". Full rationale in `docs/DECISIONS.md` (2026-07-22, "Scheduler single-owner question resolved").

**Trigger:** a GitHub Actions scheduled workflow issues an authenticated HTTP request to a single backend
endpoint. There is no in-process scheduler, no APScheduler dependency, and no leader election. Azure
Container Apps `minReplicas: 0` is preserved — the inbound request itself wakes the container.

```
GitHub Actions (cron, once daily at a fixed hour)
        │  POST /api/v1/jobs/run-due   +   X-Job-Token
        ▼
Container App (cold → wakes on request)
        │
        ▼  service-role connection (bypasses RLS — see Security)
   find subscriptions due for a reminder
        │
        ▼  INSERT INTO notification_deliveries … ON CONFLICT DO NOTHING
   conflict ⇒ already sent ⇒ skip
        │
        ▼
   render bilingual copy → deliver via push → prune dead endpoints
```

**Authentication:** a shared secret in the `X-Job-Token` header, compared using the constant-time helper
already present at `backend/app/security/compare.py` (written in an earlier session and currently
uncalled — this is its first use). The endpoint returns a generic failure on mismatch and must not reveal
whether the token was absent or wrong.

**Idempotency:** the `notification_deliveries` ledger is the correctness mechanism. A row is inserted
*before* delivery is attempted, with a uniqueness constraint on `(user_id, subscription_id, kind,
due_date)`. A conflicting insert means the reminder was already handled and the job skips it. This makes a
duplicated cron firing, a manual re-run, or a retry safe by construction rather than by timing. A shifted
renewal date produces a different `due_date` and therefore legitimately earns a new reminder.

**Timing:** one daily run at a fixed hour. The schema stores no user timezone and the primary user is in
Athens, so a fixed hour is accepted as approximate for users elsewhere. Per-timezone bucketing is not built.

**Idempotency is required, not incidental:** the job must be safe to run twice in a row by hand. This is
the primary manual test of the ledger.

## Notification Delivery Model

**Protocol:** Web Push with VAPID, via `pywebpush`. This choice is already fixed by
`docs/APP_DESCRIPTION.md` §2.5 and is what makes one implementation cover Windows, macOS, and Android
browsers plus iOS.

**Subscriptions are per-device, not per-user.** A user's laptop browser and phone are separate endpoints
with separate encryption keys, and permission is granted per-device. One user legitimately has many rows;
storage is keyed `UNIQUE(user_id, endpoint)`. A reminder fans out to every active subscription row the
user has.

**Delivery is best-effort.** A closed device means the push service queues the message subject to a TTL.
The application must not present notifications as guaranteed. The Overview tab's existing upcoming-renewals
list remains the authoritative in-app surface and the standing fallback.

**Dead subscriptions are pruned, not retried.** A `410 Gone` or `404` from the push service means the
subscription is permanently invalid (browser rotated it, user revoked permission, or iOS dropped an
unopened PWA). The correct response is deleting that row. Other failures are logged and left in place.

**iOS requires an installed web app.** Safari refuses Web Push in a normal tab and grants it only to sites
added to the Home Screen. Supporting iPhone therefore requires a web app manifest with `display:
standalone`, an icon set, and an iOS-specific instruction surface — Safari offers no install prompt, so
the user must be told to use Share → Add to Home Screen. iOS is a supported target this session.

**Delivery is separated from decision-making.** The reminder engine — due detection, lead-time resolution,
suppression, ledger writes, and message rendering — must not know how a message is sent. Push is the only
delivery implementation built this session; email arrives in Session 7 as a second adapter against the
same engine. This mirrors the provider-adapter structure in `backend/app/services/llm.py`, which already
paid off once during the Groq→Gemini migration. This is ordinary `services/` layering applied to a known
second caller, not speculative abstraction.

## Reminder Semantics

**Lead-time resolution.** Two levels, with the subscription overriding the profile:

```
effective_lead_days = COALESCE(subscriptions.reminder_lead_days, profiles.renewal_lead_days)
```

`profiles.renewal_lead_days` already exists (INT, default 3). `subscriptions.reminder_lead_days` is added
this session as a nullable column — NULL means "use my default", which keeps existing rows correct without
backfill. The rationale for the override is that a 3-day warning on an annual renewal is nearly useless,
while a long lead time on a cheap monthly subscription is noise.

**Due condition.** A subscription is due for a reminder when
`next_renewal_date - effective_lead_days <= today` and no ledger row exists for that
`(subscription, kind, due_date)`. The job must not send reminders for renewals already in the past.

**Suppression.** Only `status = 'active'` subscriptions generate reminders. Cancelled and paused
subscriptions are silent. This is evaluated **at send time**, not at schedule time — there is no
pre-scheduled queue to invalidate, which is a deliberate benefit of computing due-ness on each run.

**A reminder is per-subscription.** Three subscriptions renewing the same day produce three notifications,
matching `docs/APP_DESCRIPTION.md` §2.5 ("One notification per renewing subscription"). Digest-style
batching is not built.

**Click target.** Activating a notification opens the dashboard. The service worker focuses an existing
app window when one is open rather than opening a duplicate.

**Copy is rendered server-side and is bilingual.** This is the project's first server-side localized text
— every user-facing string to date lives in the frontend's i18n files, but a scheduled job has no session
and no browser. Copy is selected from `profiles.preferred_language` (`en` / `el`; `auto` resolves to
English, as there is no message to detect a language from). Strings must live in a dedicated module, not
inline in the job logic, so they remain reviewable and translatable. Notification content includes the
subscription name, price, and renewal date — the user's own data, delivered encrypted to their own device.

## Subscription Guidance

**Purpose:** answer "how do I cancel X?" and related questions from verified data where possible.

**Storage:** a global `service_guides` table (not user-scoped) holding curated per-service guidance:
cancel URL, ordered cancellation steps, plan tiers, and category. Schema follows
`docs/APP_DESCRIPTION.md` §5.1. RLS is enabled with authenticated-read access and no user write path —
this is reference data, following the pattern already used for `fx_rates`. Seed content covers ~15–20
well-known services and is designed to be expanded later without schema change.

**Lookup is hybrid, and its two sources have different trust levels.** This distinction is the security
core of the feature:

| Source | Trust | Rendering |
|---|---|---|
| Curated `service_guides` row | Verified data the project controls | URLs may render as clickable links |
| LLM fallback (no curated row) | **Untrusted model output** | Plain text, explicitly labelled unverified; **never linkified** |

A model-generated cancellation URL is an arbitrary attacker-influenceable destination presented to a user
in a trusted context. The tool result must therefore carry the provenance of what it returns, and the
frontend must render accordingly. The backend must never fetch a cancel URL from either source — this is
the SSRF rule in `docs/ENGINEERING_STANDARDS.md` §B applied directly.

**Surface:** the capability is exposed as `get_subscription_guide`, registered into the existing tool
registry in `backend/app/services/tools.py`. Registration is a `ToolSpec` with a Pydantic args model and a
handler; the chat loop is not modified. There is no dedicated REST endpoint and no dashboard UI for
guidance this session — chat is the only surface.

**Category inference on chat-created subscriptions.** A defect observed in live use: subscriptions added
through the chat arrive with no category. The plumbing is correct — `category` is present on
`SubscriptionCreate`, exposed in the `add_subscription` tool schema, and passed through by the handler.
The cause is the identity prompt's anti-fabrication rule, which forbids inventing "a made-up price,
category, or date". That rule is correct for a price, which is unknowable and financially material, but
it also suppresses assigning one of five known enum values to a recognisable service. The distinction to
encode is **fabrication versus classification**: the model must still never invent a price or a date, but
assigning `streaming` to Netflix is classification against a fixed taxonomy. `service_guides.category` is
the authoritative source where a curated row exists; the model's own judgement is the fallback, and
`NULL` remains correct when the service is genuinely unrecognisable. This is corrected alongside the
guidance work because it lives in the same prompt and the same tool registry.

**Prompt adjustment.** The Apollon identity block in `backend/app/services/prompts.py` currently declines
generalised financial advice and requires a disclaimer on money-related observations. It must be adjusted
so that concrete, data-grounded cancellation guidance about the user's *own* subscriptions is clearly
permitted, while the refusal of generalised financial and investment advice is preserved. The grounding
rule (every figure comes from a tool result) and the no-tool-name-leakage rule are unchanged and continue
to apply.

## Onboarding Defect Correction

A live production defect affecting every new signup, most visibly on the Google OAuth path. Two confirmed
symptoms and one latent failure, all rooted in the same design: onboarding routing is a post-fetch
`useEffect` inside the dashboard layout rather than a gate that resolves before the dashboard renders.

**Symptom 1 — the dashboard renders and loads before the wizard appears.** `DashboardShell` decides
whether to redirect based on `/me`, which it fetches itself, while rendering `<Outlet/>` unconditionally.
The Overview and all its queries therefore always mount first. OAuth compounds this by redirecting
straight to `/dashboard` with no callback route.

**Symptom 2 — the wizard reopens once after completion.** Completion clears local progress (destroying the
`entered` guard flag) while the profile mutation only invalidates the `['me']` cache without writing the
already-returned fresh profile. With no active observer on `['me']` while the wizard is mounted,
invalidation does not refetch. Returning to the dashboard, both guard conditions read stale-permissive
simultaneously and the redirect fires again.

**Latent failure — a user can be stranded un-onboarded.** The guard requires `meQuery.data` to be truthy.
If `/me` errors, `data` stays undefined, the redirect never fires, and the user never sees onboarding at
all with no error surfaced.

**Required outcome:** a new user reaches onboarding without first seeing the dashboard render and fetch;
completing the wizard returns them to the dashboard permanently; a failed profile fetch surfaces an error
state rather than silently skipping onboarding. The fix must not regress the existing resumable
behaviour — a user who leaves mid-flow is not force-redirected again and picks up via the Overview banner.
Cache-level patches alone are insufficient; the routing gate itself must move ahead of dashboard render.

## Data Model Additions

All migrations are versioned SQL under `supabase/migrations/`, applied to **dev first, then prod**. Every
new user-scoped table requires RLS policies plus a real cross-user denial test.

| Object | Type | Notes |
|---|---|---|
| `push_subscriptions` | New table, user-scoped | Per `docs/APP_DESCRIPTION.md` §5.1: `endpoint`, `p256dh_key`, `auth_key`, `user_agent`, `UNIQUE(user_id, endpoint)`. Full RLS. |
| `notification_deliveries` | New table, user-scoped | Delivery ledger. Uniqueness on `(user_id, subscription_id, kind, due_date)`. `kind` is a constrained value to allow future notification types without schema change. Full RLS. |
| `service_guides` | New table, global | Reference data. Authenticated-read RLS, no user write path. Seeded. |
| `subscriptions.reminder_lead_days` | New column, nullable INT | NULL means inherit `profiles.renewal_lead_days`. No backfill required. |

`profiles.renewal_lead_days` and `profiles.monthly_review_enabled` already exist from Session 1 and need
no migration — only wiring. `monthly_review_enabled` remains unwired this session (its feature is Session 5)
and its Settings control must stay visibly disabled rather than appearing functional.

## Security and Privacy Constraints

Session-specific applications of `docs/ENGINEERING_STANDARDS.md`. Everything there still applies; these
are the points this session newly stresses.

**The first RLS-bypassing code path.** Every backend operation to date runs under a user's JWT with RLS
scoping it automatically. The scheduled job has no user and must legitimately read across all users. That
requires a service-role connection, and the boundary must be drawn tightly: service-role access is
confined to the job's own data-access functions, never widened into shared helpers that user-facing
requests also call, and never reachable from a user-authenticated route. The existing precedent for
narrow service-role use is `backend/app/db/fx.py` and `backend/app/db/usage.py`.

**Job endpoint hardening.** Constant-time token comparison via `backend/app/security/compare.py`. The
endpoint is unauthenticated in the JWT sense and publicly routable, so it must not leak information
through error shape or timing, must be excluded from user-facing rate-limit assumptions, and must bound
its own work rather than processing an unbounded result set in one invocation.

**Push payload contents.** Notification bodies carry the user's own subscription data to their own
device over an encrypted channel — acceptable. Notification content, endpoints, and push keys must never
appear in logs; the existing "no PII or message content in logs" rule extends to notification copy and
subscription endpoints. Job logs should carry counts and outcomes, not contents.

**Untrusted model output.** LLM-sourced guidance is untrusted per `docs/ENGINEERING_STANDARDS.md` §B. It
must not be linkified, must not be rendered as raw HTML, and must pass through the existing DOMPurify
sanitization path in the chat renderer. Never fetch a user- or model-supplied URL.

**Consent and disclosure.** Web Push requires explicit opt-in; the browser permission prompt provides
this, and the fact of consent is recorded by the existence of a `push_subscriptions` row. Revocation must
be genuinely possible from Settings and must delete the stored subscription, not merely mute it. The
Privacy Policy must disclose push notification data (endpoint and keys) among collected data. No new
sub-processor is introduced — browser push services are the transport, and delivery is end-to-end
encrypted with keys held only by the browser and this application.

**Client-side storage.** The service worker and manifest introduce no new tracking. Storage remains
strictly-necessary only, so no consent banner is required — consistent with the standing decision not to
add banner theater.

## Validation and Acceptance

Session-level definition of done. Individual Tasks carry their own criteria.

1. A real push notification arrives on a **real device** ahead of a real renewal, triggered by the actual
   scheduled path (cron → job endpoint → due query → delivery), not only by the test endpoint.
2. The reminder honours a per-subscription lead-time override where set, and the per-user default otherwise.
3. Cancelled and paused subscriptions produce no reminders.
4. Running the job twice in succession sends no duplicate notification.
5. Activating a notification opens the dashboard, focusing an existing window if one is open.
6. Notification copy renders in the user's preferred language, in both English and Greek.
7. Permission opt-in is reachable from onboarding and from Settings, and revoking from Settings removes
   the stored subscription. **The original "only after at least one subscription exists" gate was removed
   (decided 2026-07-30):** notification permission is a browser-level grant independent of subscription
   count, and the gate meant anyone who skipped adding a subscription — which the flow explicitly invites —
   silently never got the chance to enable reminders.
8. The assistant answers a cancellation question for a curated service using curated data, and for an
   uncurated service returns clearly-labelled unverified guidance with no clickable model-generated link.
9. A newly created account lands in the onboarding wizard without the dashboard rendering and fetching
   first, and does not see the wizard again after completing it.
10. All new user-scoped tables have passing cross-user RLS denial tests.
11. Backend and frontend test suites pass, and `npm run build` succeeds locally before merge.

Criteria 1, 2, 5, 6, 7, 8, and 9 require User participation — several are not verifiable from the
development environment at all.

**iOS on-device push is an accepted, unverified gap (decided 2026-07-26).** Criteria 1 and the
notification/activation criteria are verified on the desktop/Android Web Push path (the same standard). The
iOS Home-Screen-installed path is implemented to spec but not proven on a real device — the developer has
no iPhone and iOS Web Push needs an HTTPS-installed PWA. This is an explicitly-accepted gap, not an
outstanding failure; see `docs/DECISIONS.md` 2026-07-26. Where these criteria say "real device", a desktop
browser satisfies them; iOS is additionally targeted in code but not verified.

**A strict frontend Content-Security-Policy is added this session (decided 2026-07-26).** The served
frontend previously had no CSP; a strict policy is added via `staticwebapp.config.json` and verified not to
break the running app, closing a standing gap against the Secure non-negotiable before deploy.
