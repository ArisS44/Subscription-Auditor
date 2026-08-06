---
date: 2026-08-06T22:45:02Z
project: SaaS Subscription Auditor — Session 4: Reminders & Guidance
stages_completed: 4
total_tasks: 32
outcome: partial
---

# Session Summary — Session 4: Reminders & Guidance

All four Stages are closed and the session's feature slice is live in production. `outcome` is recorded
as `partial` rather than `complete` because the Tracker carries no `completed_at` in its frontmatter —
the Manager never wrote an authoritative session-completion marker — and because Stage 4 closed with
three of its eight Tasks deliberately deferred to Session 5.

## Project Scope

Session 4 is the slice that makes the application reach *out* to its users for the first time, and
teaches the Apollon assistant to advise on cancelling a subscription rather than only tracking one. Its
premise: *a subscription tracker nobody opens is a spreadsheet* — the reminder is what converts passive
record-keeping into an active product.

In scope: (1) an onboarding first-login defect correction; (2) a scheduled-work foundation — externally
triggered job endpoint, delivery ledger, service-role boundary; (3) Web Push infrastructure — VAPID,
per-device subscription storage, send pipeline, dead-endpoint pruning; (4) the renewal reminder engine —
due detection, two-level lead-time resolution, suppression, bilingual server-rendered copy; (5) the
frontend delivery surface — service worker, PWA manifest, opt-in, Settings, per-subscription lead time;
(6) subscription guidance — a curated `service_guides` table surfaced through the existing chat tool
registry.

Explicitly excluded by decision, not oversight: monthly reports and the monthly-review notification
(Session 5), invoice import (Session 5), `get_recommendation` and all usage/cost-per-hour work (Session 6,
blocked on the extension), and email reminder delivery (Session 7, blocked on a verified sending domain).

This session also resolved the standing scheduler single-owner question: a GitHub Actions cron issues an
authenticated `POST /api/v1/jobs/run-due`. No in-process scheduler, no leader election, `minReplicas: 0`
preserved — the request itself wakes the container.

## Stages and Outcomes

### Stage 1 — Foundation: Schema, Secrets, and the Onboarding Fix (5 Tasks, all Done)

Delivered the database objects, secrets and frontend groundwork everything else depends on.

- **1.1 Notification & Guidance Schema** (`f8d1f46`) — `push_subscriptions`, `notification_deliveries`,
  `service_guides` and the nullable `subscriptions.reminder_lead_days`, in one migration with six real-DB
  cross-user RLS denial tests. Two decisions beyond the prompt, both Manager-verified: the ledger's
  `subscription_id` is nullable with `unique nulls not distinct` (the default NULLS DISTINCT would have
  silently allowed duplicate `monthly_review` rows — a latent bug caught a session early), and a partial
  index on `next_renewal_date where status='active'` for the user-less scan. `service_guides` is
  read-only by the *absence* of a write policy.
- **1.2 Onboarding First-Login Fix** (`cb86e97`) — moved the first-login decision out of a post-fetch
  dashboard effect into an `OnboardingGate` that resolves during render, so the dashboard and its queries
  never mount for a user who should be onboarding. Also fixed the latent stranding on a failed `/me` and
  the double-wizard. User-verified live on a new account.
- **1.3 VAPID & Job Token Provisioning** (`b96e443`) — keypair and job token across Key Vault, the
  Container App and GitHub Actions, key material never leaving the machine. Surfaced a real latent
  production defect: `frontend.yml` had been building with an **empty** VAPID public key.
- **1.4 Apollon Mark & Icon Set** (`33a77c7`) — one coherent identity across assistant mark, install icon
  set and notification icon. The User chose a third-party Noun Project mark (CC BY 3.0), making
  attribution a shipping obligation rather than a courtesy.
- **1.5 Test Fixture Rework** (`d1cd227`) — added mid-Stage after 1.1 produced 8 flaky live-DB failures
  against a documented 1–3. Two session-scoped shared users with per-test reset cut real user creation
  from 74/run to 2 (222 → 6 Auth Admin round-trips). Isolation proven by deliberate sabotage, not
  assumption.

Closed holistically: backend 140/140, frontend 116/116, `tsc -b` clean.

### Stage 2 — Reminder Pipeline & Guidance (17 Tasks, all Done)

The session's whole feature surface, plus a User-requested pre-deploy readiness phase. The Stage grew
from 11 Tasks to 17 in flight; its defining pattern was that live testing kept surfacing adjacent
defects.

Feature work (2.1–2.11): push storage/endpoints/sender, the reminder engine behind a token-authenticated
job endpoint, the scheduled GitHub Actions trigger, curated guidance through the tool registry, the
frontend delivery surface, and a strict frontend CSP. Four of those Tasks did not exist when the Stage
began — 2.7 (chat storing the model's training-cutoff date for "started today", which corrupts exactly
the field reminders depend on), 2.8 and 2.10 (API surface the Plan under-specified, both caught by
sequencing analysis *before* dispatch), and 2.11 (chat fabricating lead-time values and silently editing
a fuzzy-matched subscription).

Readiness phase (2.12–2.17) is where the Stage earned its keep:

- **2.13** measured chat latency instead of assuming and contradicted its own brief. The system prompt
  everyone suspected was worth ~1% of a turn; 3.19s of a 5.40s turn was 48 database round-trips, ~30 of
  them fetching nothing, because `rls_connection` costs 181ms even for an empty block. The Worker
  declined the prompt-condensing work — which would have risked four behavioural rules for nothing — and
  cut round-trips to 39. The same Task made the chat's wrong-target protection **structural** (`3b9a828`):
  write tools now require a `subscription_name` and refuse a write whose stated name contradicts the
  stored row, superseding the prompt-level-only limitation from 2.11.
- **2.12** added database constraints on the profile lead-time columns and bounded, *ordered* device
  reads on both job and user paths. The unbounded read on the service-role path and the missing
  `ORDER BY` were both the Worker's own finds.
- **2.14–2.17** came directly from the User's review of the running app: a language switcher on every
  pre-auth route, removal of an onboarding footer `Skip` wired to the identical handler as `Continue`, the
  read direction of language sync, and a password-policy parity fix delivered by extracting a shared
  `passwordField` so the two surfaces cannot diverge again.

Closed: backend 247 on merged `main` (5:47), frontend 171, `tsc -b` clean, `en`/`el` parity exact at 355.

### Stage 3 — Production Deploy & Live Verification (2 Tasks, both Success)

- **3.1** applied three migrations to prod with no history drift (3/6 → 6/6), verified the 18-row
  service-guides seed landed, pinned `LLM_MODEL` off its floating alias **before** the deploy (a Container
  App resolves Key Vault references only at revision start), and deployed both workflows. Live HTTPS
  verification found a production-only defect the build could not reveal: the web app manifest served as
  `application/octet-stream`, silently voiding the entire PWA identity. Fixed and redeployed inside the
  Task.
- **3.2** walked every session-level acceptance criterion against production with the User. The headline
  chain — cron → job endpoint → due query → push delivery → real device — ran end to end for the first
  time and worked in both languages. Idempotency was proven by dispatching twice (no new notifications,
  timestamps unchanged). Precedence and suppression were proven as a designed negative control: a
  subscription with a 10-day override fired where the profile default of 3 could not, while cancelled and
  paused rows dated inside any window stayed silent.

Stage 3 also found that **push revocation was broken in production**: the endpoint carried a URL in a
path segment, and Envoy (fronting Azure Container Apps) normalises percent-encoded and duplicate slashes
before routing, so the value arrived mangled and matched no stored row. The entire local test suite
passed against a defect that made consent non-revocable — a compliance failure, not a cosmetic one. Fixed
to a query parameter and re-verified. Google OAuth signup was honestly recorded as **not exercised** (no
second Google account available) — notable because that is the path the original onboarding defect was
reported on.

### Stage 4 — Beta Readiness (8 Tasks: 5 Done, 3 Deferred)

The Stage exists because Stage 3 put the app in production and real beta users immediately surfaced
blockers no amount of internal testing had. It grew from 6 Tasks to 8 mid-flight; both additions were
live production defects reported by real users.

- **4.1 Custom SMTP Provider** — Supabase's shared sender rate-limited signups, so a small group signing
  up together locked everyone out after the first few. Moved production Auth to Brevo (300/day, single
  verified sender, no domain needed), verified by five consecutive signups all reaching the inbox.
  Supabase's own independent hourly cap was also raised to 100/hour.
- **4.4 Rate-Limit Error Copy** (`74c213d`) — three distinct conditions no longer collapse onto one
  misleading "wait a minute" string.
- **4.5 Greek Translation Quality Review** (`03d4f69`) — 30 issues found, all presented to the User for
  decision and approved, 41 Greek strings changed. Highest-severity find was outside its own brief: the
  subscription form's dismiss button read «Ακύρωση», the same word as the destructive "cancel this
  subscription" action; now «Άκυρο».
- **4.7 Roll Renewal Dates Forward** (`3866e1c`, `68c0fed`) — the serious one. `next_renewal_date` was
  written only at create and update, and the due-query carries `AND s.next_renewal_date >= CURRENT_DATE`,
  so once a renewal date passed the subscription left the reminder scan **permanently**. The core feature
  worked exactly once per subscription and then went silent with no error; it had not surfaced in
  production only because every subscription was still young. The fix advances dates inside the existing
  daily job, before due-detection and only for dates strictly in the past — safe in both directions,
  since a past date was already excluded from detection and a new date is a new ledger key.
- **4.8 Comma Decimal Separator** (`dc3e038`, `df8a388`) — a beta tester on a Greek iPhone **could not
  enter a price at all**: `inputMode="decimal"` renders the iOS keypad with a locale-matched separator,
  and the price regex accepted only a dot. No accepted character was reachable on that keypad. Logged
  Done\* — the fix is verified everywhere reproducible, but the iOS premise itself cannot be confirmed
  here.
- **Deferred to Session 5 (User decision, 2026-08-07):** 4.2 Chat Link Provenance, 4.3 Require a Category
  on Manually-Added Subscriptions, 4.6 Always-On Replica & Spend Protection. All three were Ready and
  un-dispatched when the session was redirected; all are small, independent, and block nothing.

**The Stage closed with a session pivot rather than a final Task.** At the User's direction the remaining
work became preparing the repository for third-party readers: publishing the previously gitignored
`.apm/` record (~90 files, a first-time publication rather than a cleanup), a gitleaks audit of all 165
commits (clean, verified non-vacuous with a control), a rewrite of a root README that claimed four
unbuilt features and a stack the project had migrated away from, and a PolyForm Noncommercial 1.0.0
licence.

## Key Deliverables

**Backend** — `backend/app/services/{reminders,push,guides,notifications_copy}.py`,
`backend/app/db/{reminders,push,service_guides}.py`, the token-authenticated job endpoint with
constant-time comparison, and `get_subscription_guide` registered into the existing tool registry.

**Database** — `supabase/migrations/20260722143000_create_notification_schema.sql`,
`20260724160000_seed_service_guides.sql` (18 curated guides), and
`20260730090000_harden_profile_lead_time_constraints.sql`. All applied to dev and prod, six migrations,
no drift.

**Frontend** — service worker and PWA manifest, `features/notifications/` (opt-in, lead-time chips, push
support detection), `features/settings/NotificationsCard.tsx`, the Apollon icon set, a strict CSP in
`staticwebapp.config.json`, and full `en`/`el` parity at **356** keys.

**Infrastructure** — `.github/workflows/reminders.yml` (the scheduled trigger), VAPID keypair and job
token in Key Vault + GitHub Actions, `infra/supabase/EMAIL.md` (Brevo configuration, credential-free).

**Repository publication** — `LICENSE` (PolyForm Noncommercial 1.0.0, © 2026 Aristeidis Skyllas),
`NOTICE` (CC BY 3.0 Apollon attribution), rewritten root `README.md`, new `docs/README.md`, and
`.apm/archives/README.md` as the durable navigation entry point.

## Codebase State

Verified against the code, not the artifacts alone.

- **Every claimed deliverable exists.** All six migrations present, the 18-row seed confirmed, all named
  backend and frontend modules present, both new test files present, `reminders.yml` present,
  `LICENSE`/`NOTICE`/`README` present.
- **Every tracker-named commit is on `main`**, and `main` is level with `origin/main` at `d250d4b`
  (2026-08-01), 165 commits total. Only `main` exists locally.
- **No code drift.** The last code commit is `d250d4b`; everything since is documentation, licensing and
  process. The codebase is not ahead of what the Plan and Tracker describe.
- **The publication work is entirely uncommitted.** Working tree: modified `.gitignore`, `README.md`,
  `docs/APM_SESSIONS.md`; deleted `.start-session-{2,3,4}.md`; untracked `.apm/`, `LICENSE`,
  `docs/README.md`. Nothing staged. This matches the Tracker's own statement that the repo is still
  private and nothing has been committed — flipping visibility and committing are both User actions.
- **Behavioural spot-checks hold.** `PRICE_RE` accepts a comma and `normalisePrice` is applied in both the
  `PRICE_MAX` refinement and the single `formValuesToPayload` transform; the renewal-date advance runs
  before due-detection with `< CURRENT_DATE` asserted in both the read and the write; `.gitignore` no
  longer excludes `.apm/`.

Gaps between planned and implemented are entirely the three deferred Stage 4 Tasks and the acceptance
criteria that were structurally unverifiable here (iOS on-device push, Google OAuth signup).

## Notable Findings

- **A harness that calls a service function is not verification of a user-facing surface.** Stage 2 closed
  with four defects found only by the User's browser pass, after 32 automated live scenarios and a full
  unit suite passed. Three lived on the HTTP/SSE/render path a service-level harness bypasses — the worst
  being a €7.99 price rendered as "8", correct all the way to the database and broken at render.
- **Live verification found what no test could, repeatedly.** The manifest MIME defect, the Envoy path
  normalisation breaking revocation, the SMTP rate limit, and the notification-volume question all
  surfaced only against production or a real device. Treat these as the expected output of a working
  process, not as process failures.
- **Negative assertions must be proven to fail without the fix.** Three separate Stage 2 Tasks caught
  tests that passed vacuously and verified them by deliberate sabotage. Task 4.7 extended the lesson: its
  first sabotage attempt proved nothing, because the write re-asserts its condition in the `WHERE` — both
  walls had to be broken before a real failure appeared.
- **Workers corrected Manager prompts four times, and were right each time.** A function asserted to be on
  the job path when the job used a different service-role sibling; two design options offered as
  alternatives when implementing only one would have left the feature broken across logins; the Task
  Prompt's suggestion of Resend, which without a verified domain delivers only to the account holder (beta
  testers would have received nothing, and the failure would have looked identical to the bug being
  fixed); and 4.8's `toCreateInput` pair, which does not exist — there is a single shared
  `formValuesToPayload`, which is better than described.
- **Task-count growth was driven by reality, not scope creep.** Stage 2 went 11 → 17 and Stage 4 went
  6 → 8; every addition traces to a live defect, a User review finding, or pre-dispatch sequencing
  analysis.
- **`supabase db push` console output is not trustworthy without Docker running.** A second push re-listed
  applied migrations as pending and printed "Applying..." with no error, despite no `IF NOT EXISTS`
  guards. The pending list came from a stale local cache. Verify against the remote.
- **`apm archive` sweeps the `.apm/` root**, copying everything except `archives/` into the snapshot and
  deleting the originals. Durable navigation must therefore live inside `archives/`.
- **Git history is secret-scanned clean.** gitleaks over all 165 commits, verified non-vacuous with a
  control. No `.env`, key, or credential file was ever committed; nothing needs rotating before the repo
  goes public.

## Known Issues

**Open product decision — notification volume.** The first live reminder run sent 18 separate pushes to
one account in a single burst. All were legitimate, and the burst was inflated by an empty ledger
replaying months at once, which production will not do — but the engine sends one push per subscription
with no grouping and no per-user ceiling, so an ordinary day still yields three or four. This contradicts
the Spec's deliberate one-notification-per-renewing-subscription rule, so a digest is a **Spec change,
not a bug fix**. Invisible to the test suite; surfaced only when real notifications reached a real phone.

**Open decisions awaiting a User call:**
- Auth emails are English-only. Supabase Auth allows one fixed template per project with no per-user
  language, so a Greek user signs up through an entirely Greek UI and receives an English confirmation.
  This is now the *only* user-facing surface that is not bilingual.
- `en`/`el` chart-type vocabulary now diverges — the Greek names were unified during 4.5, the English
  still carries the split. Deliberate; the approved review covered Greek only.

**Unverified and accepted:**
- iOS on-device push (User owns no iPhone; needs an HTTPS-installed PWA). Implemented to spec, verified on
  the desktop path.
- 4.8's iOS premise — that a Greek-locale decimal keypad emits a comma — is documented platform behaviour
  *and* a beta tester's real-device report, but the fix ships before device confirmation. Ask a tester to
  confirm after deploy.
- Google OAuth signup was never exercised in production.
- 41 changed Greek strings have never been seen in the running app, and several are longer than what they
  replaced (layout/truncation risk in buttons and chips).

**Standing fragilities:**
- The 4.7 fix only holds while the cron actually runs. A silently failing scheduler lets dates go stale and
  reminders stop — the same silent failure mode as the original bug.
- The Brevo SMTP key expires after 90 days of *inactivity*, independently of its 2027 expiry. A personal
  project can easily go 90 days with no signup, after which signups fail silently.
- Azure `spendingLimit: Off` on a pay-as-you-go quota. Budgets alert but cannot stop spend. Task 4.6 was
  deferred with this open.
- At-most-once, channel-blind delivery ledger: a transiently-failed reminder is not retried, and the
  channel-less key will suppress the future email channel for an already-push-claimed renewal. Must be
  resolved before email sends in Session 7.

**Artifact inconsistencies found during verification** (small, worth correcting before the archive is read
by anyone else):
1. `.gitignore`'s new comment points at `.apm/README.md`, which does not exist — the navigation README
   deliberately lives at `.apm/archives/README.md`. The root `README.md` links correctly.
2. `.apm/memory/index.md` has **no Stage 3 section** — it jumps Stage 2 → Stage 4, so the session's two
   most consequential production findings (manifest MIME, Envoy path normalisation) are absent from the
   memory index despite both Task Logs existing.
3. The rewritten `README.md` states 355 i18n keys; the actual count is **356** (4.8's `pricePlaceholder`
   landed after that figure was recorded).
4. `docs/DECISIONS.md` has no entry dated 2026-07-30 or later — the accepted `--min-replicas 0`
   cold-start decision was never written up, though the Tracker flags it as due at session close.
5. `docs/LEARNING_LOG.md` labels the 4.7 entry "Session 5"; it is Session 4 work.
6. `docs/APM_SESSIONS.md`'s deferred-Task text repeats the `toCreateInput` name that Task 4.8 explicitly
   corrected, so Session 5 would inherit a function name that does not exist.
7. `lang.md` (the User-supplied Greek review input to 4.5) is no longer on disk, though the log records it
   as staying untracked in place.

**Deferred to Session 5, first thing to touch:** Tasks 4.2 (chat link provenance — model-generated URLs
currently render clickable, a documented violation of the project's own rule), 4.3 (require a category on
manually-added subscriptions), and 4.6 (always-on replica and spend protection). All three are recorded in
`docs/APM_SESSIONS.md` with full diagnostic context.

**Also carried forward:** a mobile responsive pass is a measured gap, not a regression — a beta tester
reported the app "would show up somewhat better" on a phone but has not named a specific issue. Only 19
responsive breakpoint usages exist across 9 of 84 components, and `DashboardShell` has no mobile
navigation at all. Get specifics before scoping; likely a session of its own.

## Snapshot Notice

This summary reflects the session state as of 2026-08-06T22:45:02Z. The codebase may have diverged since
this summary was created.
