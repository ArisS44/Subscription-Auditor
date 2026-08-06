---
title: SaaS Subscription Auditor — Session 4: Reminders & Guidance
---

# APM Tracker

## Task Tracking

**Stage 1:** Complete

**Stage 2:** Complete

**Stage 3:** Complete

**Stage 4:**

| Task | Status | Agent | Branch |
|------|--------|-------|--------|
| 4.1 | Done | infrastructure-agent | |
| 4.2 | Deferred → Session 5 | frontend-agent | |
| 4.3 | Deferred → Session 5 | frontend-agent | |
| 4.4 | Done | frontend-agent | |
| 4.5 | Done | frontend-agent | |
| 4.6 | Deferred → Session 5 | infrastructure-agent | |
| 4.7 | Done | backend-data-agent | |
| 4.8 | Done* | frontend-agent | |

**Stage 4 closed 2026-08-07 with three Tasks deferred (User decision).** 4.1, 4.4, 4.5, 4.7 and 4.8
are Done and merged; 4.2, 4.3 and 4.6 were Ready and un-dispatched when the User redirected the
session to preparing the repository for public release. All three are small and independent, none
blocks anything, and all three are recorded at the head of Session 5's scope in
`docs/APM_SESSIONS.md` with their full diagnostic context, so no detail is lost by deferring. **They
are the first thing to touch next session.**

**Stage 2 closed 2026-07-30** after holistic verification (backend 247 on merged `main`, 5:47; frontend 171; `tsc -b` clean; `en`/`el` parity 355). All 17 Tasks Done and merged. **The User's own full hands-on walkthrough of the merged app is still outstanding** and should happen before or alongside 3.1 — it is the check that has found every render/navigation defect this session. Stage 3 = 3.1 (prod migrations, secrets, model pin, deploy) then 3.2 (live end-to-end verification). **Infrastructure Worker is still instance 1 and needs a handoff before 3.1 is dispatched.**

## Worker Tracking

| Agent | Instance | Notes |
|-------|----------|-------|
| backend-data-agent | 2 | Handoff before 2.13 (User-directed, context limit) |
| frontend-agent | 3 | Handoff before the 4.4+4.5 batch (User-directed, wanted a fresh instance for the Greek review); loaded NO prior Task Logs |
| infrastructure-agent | 1 | Initialized; completed 1.3, 2.6. Needs handoff when next dispatched (Stage 3) |

**Cross-Agent Overrides:**
- backend-data-agent: Tasks 1.1, 1.5 (pre-Handoff, Stage 1 logs not loaded) — treat as cross-agent. Its Stage 2 logs (2.1, 2.2, 2.3, 2.7, 2.8, 2.10, 2.11) *were* loaded at handoff, so those stay same-agent.
- frontend-agent: **ALL prior Tasks** (1.2, 1.4, 2.4, 2.5, 2.9, 2.14–2.17) — treat as cross-agent. Instance 3 loaded no Task Logs at all, so it has no working familiarity with any earlier frontend work. Embed full context in any future Frontend prompt.

## Version Control

| Repository | Base Branch | Branch Convention | Commit Convention |
|-----------|-------------|-------------------|-------------------|
| Subscription-Auditor | main | `type/short-description` (feat/, fix/, chore/, docs/, refactor/, test/) | Conventional Commits (`type: description`) |

## Working Notes

**Deploy-critical (Stage 3):**
- **DEPLOYED 2026-07-31.** `main` was pushed; both workflows green; Container App revision `0000007` (image `998d3f7`); `main` is now 2 commits ahead of `origin` (docs only, matching neither path filter, so no deploy pending). Live: frontend `red-tree-0557d7c03.7.azurestaticapps.net`, backend `ca-subscription-auditor-backend.nicebush-826aba8d.germanywestcentral.azurecontainerapps.io`. Manager-verified independently: frontend 200, manifest `application/manifest+json`, `/api/v1/health` 200 **in 22.2s cold**.
- **All three migrations applied to prod, no drift** (3/6 → 6/6); `service_guides` seeded, 18 rows verified; constraint migration confirmed safe against prod's 12 real profiles first. `LLM_MODEL` pinned to `gemini-3.1-flash-lite` in Key Vault **before** the deploy, so the new revision picked it up without a forced restart.
- **`supabase db push` console output is NOT trustworthy without Docker running.** A second `db push` re-listed all three migrations as pending and printed "Applying..." with no error, despite no `IF NOT EXISTS` guards — a real re-apply would have failed. Both runs emitted `failed to cache migrations catalog ... Cannot connect to the Docker daemon`, so the pending list came from a stale local cache. Verify against the remote (`migration list --linked` / direct SQL), never the console.
- **Three migrations must reach prod, not one:** `20260722143000_create_notification_schema.sql`, `20260724160000_seed_service_guides.sql` (the 18 curated guides — without it the guidance tool returns nothing curated in production), and `20260730090000_harden_profile_lead_time_constraints.sql`. Prod has received none; dev is at six migrations, local and remote matching.
- **Supabase CLI link is project-wide and currently on dev.** Task 3.1 must relink to prod and confirm the target before applying anything, and confirm `supabase login` separately — the relink alone does not authenticate the Management API push. This has cost time in every session. Prod history desynced once before (dashboard-applied); always CLI.
- **Prod's frontend has been building with an empty `VITE_VAPID_PUBLIC_KEY`** (the GitHub secret did not exist until 1.3), so Stage 3 must redeploy the **frontend**, not only the backend. Rotation invariant: the job token must stay identical in Key Vault and GitHub Actions or scheduled runs break silently.
- **Production still runs the floating `gemini-flash-lite-latest` alias.** The pin to `gemini-3.1-flash-lite` covers local dev and `.env.example` only; deployed `LLM_MODEL` is set by infrastructure and must be updated at deploy. The alias re-pointed to a new model generation mid-session and changed chat behaviour with no code change.
- **Production signup is the least-tested path in the app — verify it first in 3.2, console open.** Verified 2026-07-31: prod has `security_captcha_enabled: True`, provider `turnstile`, a real secret configured (value not recorded here), and the `PROD_VITE_TURNSTILE_SITE_KEY` GitHub secret exists — so the CAPTCHA is real in prod and the "for testing only" badge will not ship. **Dev has captcha disabled** (`False`, provider still default `hcaptcha`, no secret), so dev never validates a token. Meanwhile the strict CSP only exists in `staticwebapp.config.json` `globalHeaders`, which only Azure Static Web Apps applies — the Vite dev server serves none of it, so the CSP's Turnstile script/frame allowances have never been exercised. The two compound: a CSP directive blocking Turnstile means no token, and prod signup fails while dev looks perfect. If the badge *is* visible in prod, the build fell back to the always-passing test key and the CAPTCHA is decorative.
- **Task 2.6's cron workflow has never been dispatched against a live backend** — its manual-dispatch check was deferred to Stage 3 and is the primary operational tool for 3.2's verification.
- **CC BY 3.0 attribution for the Apollon mark must travel into the prod deploy** (Settings credit + repo `NOTICE`).
- **Supabase Auth password policy: DONE on both projects** (`password_min_length: 8`, `password_required_characters: ''`), applied via the Management API on 2026-07-30 and verified by reading the config back. Task 3.1 confirms only. **Never use `supabase config push` for auth settings** — it pushes the whole local `[auth]` block, whose `site_url`/redirect URLs point at `127.0.0.1:3000` and would break a hosted project's OAuth callbacks and email links.

**Stage 4 notes:**
- **DEPLOYED 2026-08-01 (`5304775..d250d4b`)** — carries the renewal-date rollover, the comma price fix, yesterday's Greek pass, rate-limit copy, and the Reports/onboarding fixes. Both workflows triggered (backend + frontend paths both touched).
- **4.7 Done and merged.** The advance runs **before** due-detection and touches only dates **strictly** in the past — that restriction is what makes it safe: it cannot skip a reminder (a past date was already excluded from detection) and cannot double-send (a new date is a new ledger key, the case that key was designed for). A renewal falling **today** is deliberately left alone. Anchored on the stored date, not `start_date`, so a user-set date is not discarded. Cancelled/paused are never advanced (User decision — moving them would assert a charge that is not coming). Manager-verified: the write re-asserts both conditions in its `WHERE`, so it is safe to repeat and safe to race. 255 tests over three runs. Live-verified through the real UI and job endpoint, including a two-years-stale subscription landing correctly in one step.
- **OPEN PRODUCT DECISION — notification volume.** The live 4.7 run sent **18 separate pushes to one account in a single burst** (47 active subs, 13 renewing within 7 days). All legitimate; the burst was inflated because dev's ledger was empty so months of unsent reminders fired at once, which production will not replay. But the design point stands: the engine sends **one push per subscription**, with no grouping and no per-user daily ceiling, so an ordinary day still yields three or four. A daily digest would bound per-user volume by construction. **This contradicts the Spec's deliberate "one notification per renewing subscription" rule** (`docs/APP_DESCRIPTION.md` §2.5), so changing it is a Spec change, not a bug fix. Invisible to the test suite; surfaced only when real notifications reached a real phone.
- **First production job run should be watched.** The `advanced` count will reveal whether any real subscriptions had already lapsed; dev had 66 active and zero stale, production unchecked. Consider a manual dispatch rather than waiting for the scheduled hour, so any notification burst is observed deliberately.
- **Standing fragility worth remembering:** this fix only holds while the cron actually runs. If the scheduler fails silently, dates go stale and reminders stop — the same silent failure mode as the original bug.
- **4.8 Done* and merged — the asterisk is a real outstanding check.** Fix verified everywhere reproducible (194 tests, five of them driving the real form component and asserting on the request body, plus a three-way vacuity check). **What cannot be verified here: that an iOS decimal keypad in a Greek locale emits a comma** — the User owns no iPhone. That premise is documented platform behaviour *and* is the beta tester's own bug report from a real device, so it is not speculative; but the fix ships before device confirmation. **Ask a beta tester to confirm on their iPhone after the deploy.** Same shape as the accepted iOS push gap.
- **Worker correction to the 4.8 prompt:** the `toCreateInput` / update-sibling pair I described does not exist — there is a single shared `formValuesToPayload` transform, which is better than described, so normalisation has exactly one choke point and no comma can reach the backend by either route. Also: the stored value was not read back from the database; the request body carrying `"7.99"` is the strongest evidence obtained.
- **4.8 added 2026-08-01 (beta-tester report, URGENT — blocks the deploy).** A Greek iPhone user **cannot enter a price at all**. The price input is `inputMode="decimal"`, so iOS renders the decimal keypad with the separator key matching the *device locale* — a comma on a Greek iPhone — while `PRICE_RE = /^\d+(\.\d{1,2})?$/` accepts only a dot. No accepted character is reachable on that keypad. Fix accepts one `.` or `,` and normalises to `.` before the API; note `PRICE_MAX`'s `Number(v)` refinement gives `NaN` on a comma and must run on the normalised value. Thousands separators deliberately NOT supported (ambiguous, corrupts prices). Needs real-iPhone confirmation — a desktop browser cannot reproduce it.
- **4.7 added 2026-08-01 (User-reported) and is the HIGHEST PRIORITY remaining Task — dispatch it first.** `next_renewal_date` is written only at create and update; nothing advances it once the date passes. The User noticed the stale date in the Subscriptions tab. The serious half is `db/reminders.py`'s due-query condition `AND s.next_renewal_date >= CURRENT_DATE`: once a renewal date passes, that subscription is **permanently excluded from the reminder scan** and never fires again. The core feature works exactly once per subscription. Not yet visible in production only because every subscription is still young — it would have surfaced on real users in weeks, silently, with no error.
- **4.4 + 4.5 Done and merged (`5304775`).** 181 tests, parity 355/355 verified by the Manager, all five prior Greek corrections intact, calque still gone. Highest-severity find was the Manager's-prompt-independent #12: the subscription form's dismiss button read «Ακύρωση» — the same word as the destructive "cancel this subscription" action — now «Άκυρο», matching the other dialogs. Verified in the merged file.
- **NOT LIVE-VERIFIED: 41 changed Greek strings have never been seen in the running app**, and several are longer than what they replaced (layout/truncation risk in buttons and chips). The rate-limit copy paths were not exercised either — they need a real limit to trigger. Green tests here are internal consistency only. **Recommend a local visual pass in Greek before the push.**
- **Extra User-directed work rode along on the same branch** (in the deploy): `38b8920` makes the Reports tab non-interactive and redirects its route; `947d0a1` drops the empty slide after "Skip for now" and rewords the chat method card. Both tested and vacuity-checked.
- **OPEN decision: `en`/`el` chart-type vocabulary now diverges.** The Greek chart-type names were unified during the review; the English still carries the split the Greek just lost. Deliberate — the approved review covered Greek only. Needs a User call on whether English follows.
- **4.1 Done — production email now goes through Brevo** (300/day free, `smtp-relay.brevo.com:587`, single verified sender `arisskyllas2004@gmail.com`, no domain needed). Verified by five consecutive signups all delivering to the Gmail **inbox**. Supabase's own hourly cap was also raised to 100/hour — it enforces independently of the provider, so leaving it low would have swapped one limit for another. No deploy needed (Auth config). Docs in `infra/supabase/EMAIL.md`.
- **Resend is a trap for this project — do not reach for it.** Without a verified domain it only delivers to the account holder's own address, so beta testers would have received nothing and the failure would have looked identical to the bug being fixed. The Task prompt suggested it; the Worker checked provider docs and rejected it.
- **The Brevo SMTP key expires after 90 days of INACTIVITY**, independently of its 2027 expiry. A personal project can easily go 90 days with no signup or password reset, after which signups fail silently with no apparent cause. First thing to check if signup emails ever stop; documented in `infra/supabase/EMAIL.md`.
- **Dev deliberately left on Supabase's shared sender** (User direction) — an accepted dev/prod difference, not an oversight.
- **OPEN decision: auth emails are English-only.** Supabase Auth templates are one fixed template per project with no per-user language, so a Greek user signs up through an entirely Greek UI and gets an English confirmation email. This is now the *only* user-facing surface that is not bilingual — push notifications are, off `profiles.preferred_language`. Fixing it means either a dual-language template or sending confirmations from the backend. Needs a User decision; not blocking the beta.

**Repository publication (2026-08-06/07, Manager-executed at User direction):**
- **`.apm/` was gitignored and is now published.** `.gitignore` line 3 excluded the whole folder, so
  none of the process record was ever in the repo — this was a first-time publication of ~90 files,
  not a cleanup. Excluded from publication: `bus/` (message transport, empty `task.md` files and
  stale reports), `worktrees/`, `metadata.json`, and `.claude/` (third-party APM framework files —
  redistributing them under this repo's licence would be wrong; the README links to the upstream
  project instead).
- **`apm archive` sweeps the `.apm/` root.** Verified in the CLI source (`services/archive.js`): it
  copies everything except `archives/` into the snapshot, then deletes the originals, keeping only
  `archives/` and `metadata.json`. The navigation README therefore lives at
  **`.apm/archives/README.md`**, not the root, or it would be buried inside session 4's archive and
  the root README's link would break. Anything future sessions add at the `.apm/` root has the same
  fate — put durable navigation inside `archives/`.
- **Session run-books are gitignored** (`.apm/sessions/`, also `.apm/archives/*/sessions/`). They are
  pure operating mechanics with no reader value, and were previously tracked at the repo root as
  `.start-session-*.md`, which are now removed from the repo but kept on disk.
- **Git history secret-scanned clean.** gitleaks v8.9.0 over all 165 commits: no leaks. Verified
  non-vacuous with a control (a secret committed then deleted was still detected). No `.env`,
  `.pem`, `.key`, `.p12`, `.pfx`, `vapid_keys.json` or `.tfvars` was ever committed. **Nothing needs
  rotating before the repo goes public.**
- **The root README was substantially wrong and has been rewritten against the codebase.** It
  claimed a browser extension, invoice import, monthly reports and cost-per-hour — none of which
  exist — and described a pre-Session-4 stack (Groq/Llama 3.3, APScheduler, pdfplumber, pytesseract,
  structlog, supabase-py, Zustand, React Router v6), none of which are dependencies. It also claimed
  GDPR data export and deletion, which `me.py` does not implement. Now split into "Built and
  deployed" vs "Planned, not yet built", with the stack matching `pyproject.toml` and
  `package.json`.
- **Licence: PolyForm Noncommercial 1.0.0** (User decision), canonical text fetched rather than
  recalled. Copyright holder **Aristeidis Skyllas** (confirmed by the User). `Required Notice:` lines
  carry attribution to redistributors. A scope note, explicitly outside the licence text, keeps
  third-party assets under their own terms and points at `NOTICE` (the CC BY 3.0 Apollon mark).
  **GitHub will not recognise PolyForm** and shows no licence badge — cosmetic, accepted.
- **The repo is still private and nothing has been committed.** Flipping visibility is a User action.

**Accepted gaps and standing decisions (do not re-raise this session):**
- **Cold start accepted: `--min-replicas 0` stays (User decision 2026-07-31).** Measured 22.2s to first response from cold. Beta testers are the User's friends and will be told the first load is slow. Not a defect; do not re-raise during verification. Revisit if the audience widens beyond people who can be briefed. Worth an entry in `docs/DECISIONS.md` at session close.
- **iOS on-device push is an accepted unverified gap** (User has no iPhone; needs an HTTPS-installed PWA). Implemented to spec, verified on the desktop path. Do not block Stage 3 on it; check opportunistically if a device appears.
- **`render_table` requires a `get_analytics` call even for `query_subscriptions` rows.** The grounding guard over-enforces in a safe direction. User decision: leave it, revisit in a later session.
- **At-most-once + channel-blind ledger** (`DECISIONS.md` 2026-07-24): a transiently-failed reminder is not retried, and the channel-less ledger key will suppress the future email channel for an already-push-claimed renewal. Accepted for push-only; must be resolved before email sends in Session 7.
- **Multiple reminders per subscription** — User asked; out of scope, contradicts the Spec's one-reminder-per-renewal model, would need schema work. Future session.
- **The client is deliberately stricter than the server on passwords** (server enforces length only; client also wants a letter and a digit). Safe direction, but a password set via the dashboard or API can be valid server-side yet fail the form. Not a defect.

**Candidates for a future session (measured, not speculative):**
- **MOBILE RESPONSIVE PASS — real user feedback, awaiting specifics.** A beta tester on a phone reported the app "would show up somewhat better" on mobile, but has **not yet named a specific issue** — get specifics before scoping. Measured state: only **19 responsive breakpoint usages across 9 files** out of 84 `.tsx` components. `DashboardShell` is a hard `flex h-svh` with a permanently-visible sidebar and fixed `px-6` padding — no `md:hidden`, no drawer/sheet, no mobile navigation anywhere. The viewport meta tag is correct, so it degrades to "cramped", not "zoomed-out desktop site". This is a gap, not a regression: the Spec's design target was a dark-mode desktop dashboard and mobile was never scoped. Questions to ask before planning: is it the sidebar crowding content, text/touch-target size, tables/charts overflowing, or is she in a browser tab rather than an installed PWA (installed gains standalone display and vertical room)? Likely a session of its own rather than a Task — sidebar→drawer, table→card reflow, every surface checked at 375px, plus real-device testing.
- **The backend test suite is ~70% fixture overhead** — ~1.16s per test before any assertion (301ms fresh `asyncpg.connect()` + 856ms for `_reset_user_data`'s seven statements), ~4.6 min of a 6.7-min run. Batching the reset into one round-trip and reusing one connection would plausibly halve it, which matters because the three-consecutive-runs rule costs ~20 minutes per judgement.
- **Rejected chat optimisations, with reasons, so they are not re-proposed:** batching message inserts is unsafe (`created_at` is transaction-start time and `id` is a random uuid → non-deterministic replay order, which Gemini rejects; needs an ordering column, i.e. a migration); session-scoped `set_config` is a cross-user data leak (User ruled it out); reordering `enforce_caps` saves ~225ms but changes cap semantics.

**Operational:**
- **Sequential dispatch, no worktrees (User preference).** One Worker at a time in the main working directory on its feature branch; check out `main` before merging. `.apm/` is gitignored.
- **Stale dev servers have squatted ports 5173–5175 across sessions and serve old code.** This nearly produced two false verification results. Confirm the port actually serving your build before trusting a manual check.
- **Provider latency is independently volatile** — mid-session the provider degraded for hours (a bare five-word request took 17–29s). Do not read an end-to-end latency number taken in such a window as a result.
