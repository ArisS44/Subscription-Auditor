---
title: SaaS Subscription Auditor — Session 4: Reminders & Guidance
---

# APM Memory Index

## Memory Notes

- **Sequential dispatch, no worktrees (User preference).** The User runs one Worker at a time and is present for each Task. Workers operate in the main directory on their feature branch, which keeps all untracked working state (`.env`, `.venv`, `node_modules`, Supabase link) available with no per-worktree setup. The main directory therefore sits on the active feature branch between dispatch and merge; check out `main` before merging. This suits a session where most acceptance is live User verification.
- **The User verifies live and catches real defects.** Onboarding and icon legibility confirmed by hands-on use ("both issues fixed", "im happy"); the live push send (2.1) proved the VAPID keypair against Apple's push service; the live double-run (2.2) proved exactly-once against the real account. A User *question* during 2.2 also exposed a real TTL delivery gap that all green tests had missed. Continue to treat green tests as necessary-not-sufficient and pause for live verification wherever the Spec flags it — this project's history is unambiguous that live checks catch what tests do not.
- **A globally-scoped (user-less) job is a standing test hazard against shared dev** — it touches every account's real data including the developer's own devices. Tests assert per-subscription, avoid destructive global outcomes, and restore mutated global tables; precedent `test_reminders.py`. Now a Rule in `CLAUDE.md`. Relevant to the Session 5 monthly-review job.
- **Test suite now shares two session-scoped Supabase users** (`conftest.py::_shared_users` + `_reset_user_data`). Every new user-scoped table must be added to `_reset_user_data` or its rows leak between tests silently; denial tests need a positive control; the suite must stay serial and be judged over three runs (the flakiness signal is noisy — 8 failures one day, 1/2/0 the next on identical code). All three are now Rules in `CLAUDE.md`. Supersedes the old `backend-suite-shared-dev-flakiness` framing: creation pressure is largely removed, but shared-dev exposure remains, and local Supabase in Docker is the remaining lever (not adopted; Docker not running here).
- **The Apollon mark is a third-party CC BY 3.0 asset** (Noun Project, "apollo" by Maxicons), chosen by the User over original alternatives. Attribution (Settings credit + repo `NOTICE`) is a shipping requirement and must travel with the assets into every downstream consumer (PWA manifest, notifications) and the prod deploy. Only the paired sun glyph (sub-96px favicon/badge) is original and unattributed.
- **Three Stage 1 constraints carry into Stage 2/3** and are tracked in the Tracker Working Notes: the job endpoint must fail closed when `JOB_TOKEN` is unset (2.2); the VAPID keypair is provisioned but unproven and needs live device verification (2.1); and prod's frontend has been building with an empty VAPID public key, so Stage 3 must redeploy the frontend, not only the backend.

- **A harness that calls a service function is not verification of a user-facing surface.** Stage 2 closed with four defects found only by the User's browser pass, after 32 automated live scenarios and a full unit suite passed — three of them lived on the HTTP/SSE/render path a `stream_turn` harness bypasses, the worst being a €7.99 price rendered as "8" (correct all the way to the database, broken at render). Now a `CLAUDE.md` Rule. The same pattern recurred outside chat: the onboarding skip card advanced without recording the choice, and looked correct only because a first-time user's `method` is `null`. Prefer the User's hands-on pass wherever one is possible; this project's record on the point is unambiguous.
- **Negative assertions must be proven to fail without the fix.** Three separate Tasks this Stage caught tests that passed vacuously or verified them by deliberate sabotage — a language-sync test that passed with its guard deleted, constraint tests that would pass with no constraint on the table (because they went through the API), and the wrong-target guard's over-correction tests. Breaking the thing on purpose and confirming red is now the established bar for any test pinning a guard, and it repeatedly found tests that proved nothing.
- **A client-side policy and the server policy it mirrors must change in one change-set.** Raising the hosted Supabase password minimum while one route still carried `minLength={6}` made that route immediately looser than the server — the one direction the project's own policy module forbids. Whichever side is looser becomes a live defect for the width of the gap. Applies to any future validation that exists in both places.
- **Two Manager prompts this Stage were wrong or narrower than their objective, and the Workers caught both** — one asserted a function was on the job path when the job used a different service-role sibling (an imprecision inherited from an earlier finding), and one offered two design options as alternatives when implementing only one would have left the feature broken across logins. Task Prompts carry inherited assumptions; the `Instruction Accuracy` clause earns its place, and a Worker pushing back on a prompt is a good signal rather than friction.

## Stage Summaries

### Stage 1 - Foundation — Schema, Secrets, and the Onboarding Fix

All five Tasks Done and merged to `main` (local; nothing pushed). Delivered the database objects, secrets, and frontend groundwork the reminder and guidance features build on, plus an out-of-thread fix for a live onboarding defect and the assistant's visual identity. The Stage was verified holistically as a merged whole before closing: backend 140/140 (single run, 2 users created — the fixture rework proving itself), frontend 116/116, frontend `tsc -b` build clean.

Dispatched sequentially at the User's preference (one Worker at a time, no worktrees), in the order 1.1 → 1.3 → 1.5 → batch(1.2 + 1.4). All three Workers were involved; the Backend Data Agent ran two Tasks.

**Task 1.1 (Backend, `f8d1f46`)** created `push_subscriptions`, `notification_deliveries`, `service_guides`, and the nullable `subscriptions.reminder_lead_days` column in one migration on dev, with six real-DB tests proving cross-user RLS denial and the ledger's uniqueness constraint. Two sound decisions beyond the prompt, both Manager-verified: `notification_deliveries.subscription_id` is nullable with `unique nulls not distinct` (default NULLS DISTINCT would have silently allowed duplicate `monthly_review` rows — a latent bug caught a session early; syntax already shipped to prod in Session 3, so no Stage 3 risk), and a partial index on `next_renewal_date where status='active'` for the user-less reminder scan. `service_guides` is read-only to users by the *absence* of a write policy (RLS denies by default).

**Task 1.3 (Infrastructure, `b96e443`)** generated and provisioned a VAPID keypair and a job token across Key Vault, the Container App (revision `--0000006` Running), and GitHub Actions, keeping key material entirely local (generated via `cryptography`, printing only the public key). Found the prompt premise partly stale — VAPID plumbing pre-existed — and surfaced a real latent prod defect: `frontend.yml` had been building with an empty VAPID public key. Three constraints on later Tasks recorded (fail-closed job token, unproven keypair, frontend redeploy).

**Task 1.5 (Backend, `d1cd227`)** was added mid-Stage after Task 1.1 surfaced escalating live-DB flakiness (8 failures vs a documented 1–3), on the User's decision to fix it before Stage 2. Reworked `conftest.py` to two session-scoped shared users with per-test `_reset_user_data`, cutting real-user creation from 74/run to 2 (222 → 6 Auth Admin round-trips). Isolation proven empirically, not assumed: RLS disabled on all six user-scoped tables made all six denial tests fail, then RLS was restored and Manager-verified ON across all nine tables. Three durable Rules added to `CLAUDE.md`.

**Task 1.2 (Frontend, `cb86e97`)** fixed a live onboarding defect by moving the first-login decision out of a post-fetch dashboard effect into an `OnboardingGate` that resolves during render — so the dashboard and its queries never mount for a user who should be onboarding. Also fixed the latent stranding (surfaced error state on `/me` failure) and the double-wizard (writing the PATCH-returned profile into cache rather than bare invalidation), with resumability preserved. User-verified live on a brand-new account.

**Task 1.4 (Frontend, `33a77c7`)** established one coherent Apollon identity across the assistant mark, app icon set, and notification icon. The User selected the mark interactively across several rounds, landing on a third-party Noun Project icon (CC BY 3.0). Full install icon set produced (228 KB): Apollo figure ≥96px, original sun glyph below. Attribution shipped in Settings and a repo `NOTICE` — a licence obligation that must travel into every downstream consumer and the prod deploy. Icons are produced but not yet wired into a web app manifest; that is Task 2.4's downstream work, and the assets are named and ready.

**Key coordination note:** two planning changes were made mid-Stage — Task 2.3 was extended to also fix a User-reported "chat-created subscriptions have no category" defect (same prompt, same Worker), and Task 1.5 was added. Both Spec and Plan updated accordingly.

**Task Logs:**
- task-01-01.log.md
- task-01-02.log.md
- task-01-03.log.md
- task-01-04.log.md
- task-01-05.log.md


### Stage 2 - Reminder Pipeline & Guidance

Seventeen Tasks, all Done and merged locally to `main` (nothing pushed all session; `main` sits 61 commits
ahead of `origin/main` because pushing triggers the production deploy). The Stage delivered the session's
whole feature surface — Web Push storage and sending, the reminder engine behind a token-authenticated job
endpoint, the scheduled GitHub Actions trigger, curated subscription guidance through the chat tool
registry, the frontend delivery surface (service worker, PWA manifest, opt-in, Settings, lead times), and a
strict frontend CSP — then a User-requested pre-deploy readiness phase that grew from three Tasks to six as
hands-on testing kept finding real work.

Dispatched sequentially throughout at the User's preference, one Worker at a time, in the main working
directory rather than worktrees. All three Workers were handed off mid-Stage as they approached context
limits: Backend before 2.13, Frontend before the 2.14+2.15 batch, and Infrastructure still pending its
first handoff before Stage 3.

**The feature work (2.1-2.11)** was coordinated by Manager 1 and is recorded in its handoff log. Its
defining pattern was that live testing kept surfacing adjacent defects, which drove four Tasks that did not
exist when the Stage began: 2.7 (the chat storing the model's training-cutoff date for "started today"),
2.8 and 2.10 (backend API surface the Plan had under-specified, both found by sequencing analysis before
dispatch rather than by a Worker hitting a wall), and 2.11 (the chat fabricating lead-time values and
silently editing a fuzzy-matched subscription).

**The readiness phase (2.12-2.17)** was where the Stage earned its keep. Task 2.13 measured chat latency
instead of assuming, and contradicted its own brief: the system prompt everyone suspected was worth ~1% of
a turn, while 3.19s of a 5.40s turn was 48 database round-trips, ~30 fetching nothing, because
`rls_connection` costs 181ms even for an empty block and a tool turn opened seven. Condensing the prompt
would have risked four behavioural rules for nothing; the Worker declined to do it and cut round-trips to
39 instead (commits `5e585fc` onward). The same Task made the chat's wrong-target protection **structural**
rather than prompt-level — the three write tools now require a `subscription_name` and refuse a write whose
stated name contradicts the stored row (`3b9a828`) — which supersedes the "prompt-level only" limitation
recorded after 2.11.

Tasks 2.14-2.17 were driven directly by the User's review of the running app. 2.15 mounted a language
switcher on every pre-auth route after the User observed that nothing let a visitor change language before
login (the premise needed correcting first: the browser detector was already active, so the gap was the
missing *override*, not a hardcoded English default), and removed an onboarding footer `Skip` button that
was wired to the identical handler as `Continue` at all five call sites. 2.16 added the read direction to
the language sync, which required both design options the prompt had offered as alternatives. 2.17 closed a
password-policy mismatch found by 2.16's audit, and did it by extracting a shared `passwordField` consumed
by both signup and reset rather than duplicating a schema — removing the opportunity for the two surfaces
to diverge again. 2.12 closed the Stage with database constraints on the profile lead-time columns and
bounded, *ordered* device reads on both the job and user paths (the missing `ORDER BY` was the Worker's own
find, and matters independently: a `LIMIT` without a total ordering leaves which devices survive
unspecified).

**Out-of-band work the User directed mid-Stage**, all live-verified: the LLM model pinned to
`gemini-3.1-flash-lite` after the `-latest` alias re-pointed to a new generation mid-session; the
onboarding notification opt-in un-gated from requiring a subscription (a deliberate reversal of a 2.4
decision, recorded in the Spec); signup and login validation hardened; and the hosted Supabase password
minimum raised to 8 on **both** dev and prod via the Management API, verified by reading the config back.
That last one was initially declined on the belief that the frontend gates signup — it does not, since the
browser calls Supabase Auth's public API directly.

**Verified holistically before closing:** backend 247 passed on three consecutive serial runs during 2.12
and again on merged `main` (5:47), frontend 171 passed, `tsc -b` clean, `en`/`el` parity exact at 355 keys.

**Carried into Stage 3:** three migrations must reach production, not one — the notification schema, the
service-guides data seed, and the profile constraint migration; production still runs the floating model
alias; and the User's full hands-on walkthrough of the merged app was still outstanding at Stage close.

**Task Logs:**
- task-02-01.log.md through task-02-17.log.md

### Stage 4 - Beta Readiness

Eight Tasks. **Five Done and merged (4.1, 4.4, 4.5, 4.7, 4.8); three deferred to Session 5 (4.2,
4.3, 4.6)** by User decision when the session was redirected, in its final stretch, to preparing the
repository for public release. The Stage existed because Stage 3 put the app in production and real
beta users immediately surfaced blockers that no amount of internal testing had — which is the
Stage's defining pattern and the reason it grew from six Tasks to eight mid-flight.

**The two Tasks added mid-Stage were both live production defects reported by real users.** 4.7 was
the serious one: `next_renewal_date` was written only at create and update, and `db/reminders.py`'s
due-query carries `AND s.next_renewal_date >= CURRENT_DATE` — so once a renewal date passed, that
subscription left the reminder scan permanently. The core feature worked exactly once per
subscription and then went silent with no error. It had not surfaced in production only because
every subscription was still young. The fix advances dates inside the existing daily job, **before**
due-detection and only for dates strictly in the past, which is what makes it safe in both
directions: a past date was already excluded from detection so no reminder can be skipped, and a new
date is a new ledger key, which is the case that key was designed for. 4.8 was reported by a beta
tester who **could not enter a price at all** — `inputMode="decimal"` renders the iOS keypad with a
locale-matched separator, a comma on a Greek iPhone, while `PRICE_RE` accepted only a dot. No
accepted character was reachable on that keypad.

**4.1 unblocked the beta outright.** Supabase's shared email sender rate-limited signups, so a small
group signing up together locked everyone out after the first few. Moved to Brevo. The Worker
rejected the Task Prompt's own suggestion of Resend after checking provider docs — without a
verified domain it delivers only to the account holder, so beta testers would have received nothing
and the failure would have looked identical to the bug being fixed. That is the fourth time this
session a Worker corrected a Manager prompt and was right.

**4.5 (Greek quality pass) found its highest-severity issue outside its own brief:** the subscription
form's dismiss button read «Ακύρωση», the same word as the destructive "cancel this subscription"
action. Now «Άκυρο».

**The Stage's most consequential open question is a product decision, not a defect.** The first live
run of the reminder engine sent 18 separate pushes to one account in a single burst. All were
legitimate, and the burst was inflated by an empty ledger replaying months at once, which production
will not do — but the engine sends one push per subscription with no grouping and no per-user
ceiling, so an ordinary day still yields three or four. This contradicts the Spec's deliberate
one-notification-per-renewing-subscription rule, so a digest is a Spec change rather than a bug fix,
and it is invisible to the test suite: it surfaced only when real notifications reached a real
phone.

**The Stage closed with a session pivot rather than a final Task.** At the User's direction the
remaining work became preparing the repository for third-party readers — publishing the previously
gitignored `.apm/` record, auditing 165 commits for secrets (clean), correcting a root README that
claimed four unbuilt features and a stack the project had migrated away from, and applying a
licence. Details are in the Tracker's Working Notes; the durable structural finding is that
`apm archive` sweeps the `.apm/` root, so durable navigation must live inside `archives/`.

**Task Logs:**
- task-04-01.log.md
- task-04-04.log.md
- task-04-05.log.md
- task-04-07.log.md
- task-04-08.log.md
