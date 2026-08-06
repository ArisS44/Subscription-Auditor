---
agent: backend-data-agent
outgoing: 1
incoming: 2
handoff: 1
stage: 2
---

# Backend Data Agent Handoff 1 (Backend Data Agent 1 → Backend Data Agent 2)

## Summary

Instance 1 completed **9 Tasks, all Success**: Tasks 1.1 and 1.5 in Stage 1, and Tasks 2.1, 2.2, 2.3, 2.7, 2.8,
2.10, 2.11 in Stage 2. All work was merged into `main` by the Manager; no feature branch of mine remains open
and the working tree was clean at handoff.

Stage 2 held 11 Tasks, 7 of which were mine. The other four belonged to other Workers (2.4 and 2.5 frontend,
2.6 infrastructure, 2.9 frontend) and I did not read their logs.

**Auto-compaction occurred during this instance.** Everything up to and including Task 2.7 is reconstructed
from a compaction summary rather than held first-hand; Tasks 2.8, 2.10, and 2.11 are first-hand. The
reconstructed portion is detailed and I have no reason to doubt it, but where it matters the Task Logs
themselves are authoritative over anything recalled here.

## Working Context

**The surface I built.** Stage 2 was the notification stack end to end: schema (`push_subscriptions`,
`notification_deliveries`, `service_guides`, `subscriptions.reminder_lead_days`), the Web Push storage and
delivery adapter, the user-less reminder engine and its token-authed job endpoint, curated service guides plus
the guidance LLM tool, then three follow-up fixes (current-date injection, lead-time API exposure, device list)
and one chat-behaviour fix.

**Verification discipline — the most important thing to carry forward.** This project's history is unambiguous:
green tests repeatedly failed to catch defects that live checks found immediately. Two habits emerged and both
earned their keep:

1. *Sabotage every negative assertion.* A test asserting "this cannot happen" passes identically when it tests
   nothing. I broke each such guarantee deliberately and confirmed the test went red before trusting it —
   disabling RLS on all six user-scoped tables (Task 1.5), making `monthly_review_enabled` writable in both
   places (2.8), and widening both the push query and the push response model (2.10). The 2.10 case was the most
   instructive: widening the *query* left tests green because Pydantic drops unknown kwargs, so the response
   model — not the column list — is the load-bearing wall. Sabotage is what revealed which wall mattered.
2. *Live-verify anything a stub cannot exercise.* Live checks caught a TTL bug that silently dropped
   notifications to sleeping devices, a date-fabrication bug (the model used its training-cutoff date), and in
   Task 2.11 a prompt rule that passed every text test while the model ignored it.

**Live-check harness pattern.** For chat work I drove `chat_svc.stream_turn` directly from a throwaway script
rather than the interactive REPL: create a `repl-*@example.com` user, seed subscriptions, run each scenario in a
**fresh conversation** so history does not bleed, then read verdicts from the **database and the tool list** —
never the model's prose, which will describe a successful edit whether or not one occurred. Reset every row the
scenarios mutate **between cases**; I got this wrong once and a failed English scenario corrupted the Greek
baseline. Scripts lived in job scratch and were deliberately not committed.

**Prompt-editing gotchas.** `_APOLLON_IDENTITY` in `backend/app/services/prompts.py` was refined three times
(2.3, 2.7, 2.11) and is now dense with rules that must not be disturbed. Two mechanical traps: the prompt
hard-wraps at ~76 cols, so any test assertion longer than a few words straddles a line break and can never match
(this cost me two correction loops across two Tasks despite the test file warning about it); and module-level
constants are evaluated once at import, so anything time-dependent must be computed per request inside
`build_system_prompt`.

**Prompt rules must name the case to exclude.** The Task 2.11 finding worth repeating: "act only on an
unambiguous match" was obeyed in Greek and disobeyed in English, because with one similar subscription name the
model sees no ambiguity — one candidate, one choice. Abstract criteria delegate the judgement back to the model,
which is the thing that was wrong. Naming the excluded case ("EVEN IF exactly one looks similar") fixed it.
Verify prompt behaviour in **both** languages; one language is not evidence.

**Test-suite structure I own.** `conftest.py` shares two session-scoped Supabase users reset per test by
`_reset_user_data`. Any new `user_id`-scoped table **must be added to its delete list** or rows leak between
tests as silent contamination. The suite must run serially. Judge regressions over three consecutive runs — the
flakiness signal is genuinely noisy.

## Working Notes

**Environment as I left it.** Nothing running: no uvicorn, nothing on port 8000, no pytest. `main` is at
`b13aed7`, working tree clean. The backend restarts with
`uv run uvicorn app.main:app --reload --port 8000` from `backend/`. Baseline is **227 tests passing**, ~6
minutes per serial run.

**Shared dev holds real user data.** The dev Supabase project contains the developer's real account (66
subscriptions), their real Safari push device, and four genuine delivered reminders from 2026-07-24 — alongside
old `live-*`/`repl-*`/`smoke-*` test accounts. Never delete by pattern. Audit ownership first. Tests against
globally-scoped jobs must assert membership of a specific test row rather than global counts, and must never
trigger an outcome that would prune real devices.

**Do not run long suites through `tail`.** I piped three runs through `tail -6`, which emits nothing until the
run completes — so a run that hung for 55 minutes looked identical to a healthy one, and I told the User
"nothing is wrong" from a log whose last write was 53 minutes old. They caught it twice, correctly. Stream
progress instead, and check log mtime plus process elapsed time before reporting a background run as healthy.
Killing a run mid-flight skips the session fixture's cleanup and orphans `test-*@example.com` Auth users.

**Findings I raised that the Manager has not fully closed.** Carried here so they are not lost:
- `profiles.renewal_lead_days` and `monthly_review_enabled` are nullable with defaults rather than `NOT NULL`,
  which the non-nullable API response shape assumes; and `renewal_lead_days` has **no DB CHECK at all**, so its
  0–30 bound rests on Pydantic alone with no second wall. Recommended a follow-up migration (Task 2.8).
- `db/push.py::list_subscriptions` — the key-carrying one used by the delivery fan-out — is unbounded, on the
  reminder job's path where bounded work per invocation is an explicit standard (Task 2.10).
- Reminder delivery is at-most-once and the ledger key is channel-blind, so a push claim will suppress a future
  email channel for the same renewal (Task 2.2; recorded as deferred).
- Chat wrong-target protection is prompt-level only — the model still holds an unrestricted
  `update_subscription` accepting any id it picks (Task 2.11). Commit `8b2941f` suggests the Manager recorded
  this as a deferred structural fix.

**Layering constraint that shaped several Tasks.** Service-role (RLS-bypassing) access is confined to a
user-less job's own data-access functions and is never reachable from a user-authenticated route. This is why
`db/reminders.py` **deliberately duplicates** `get_active_push_subscriptions` and `delete_push_subscription`
rather than importing the versions in `db/push.py`. That duplication is intentional; do not "clean it up".
