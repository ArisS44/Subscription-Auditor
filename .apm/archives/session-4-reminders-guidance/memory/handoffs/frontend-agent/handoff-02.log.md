---
agent: frontend-agent
outgoing: 2
incoming: 3
handoff: 2
stage: 4
---

# Frontend Agent Handoff 2 (Frontend Agent 2 → Frontend Agent 3)

## Summary
Instance 2 completed **four Tasks**, all in Stage 2: Task 2.15 (Pre-Auth Language Switch & Onboarding Footer
Simplification), Task 2.14 (Language & Copy Review), Task 2.16 (Restore a Stored Language Preference on
Login) and Task 2.17 (Password Policy Parity on the Reset Flow) — logs at
`.apm/memory/stage-02/task-02-1{4,5,6,7}.log.md`. All four were Success, each live-verified by the User, and
each committed to its own branch and later merged by the Manager.

**Auto-compaction occurred during this instance.** First-hand recollection covers the four Stage-2 Tasks
above. Everything after them — the whole of Stage 3, and Stage 4 up to the current batch — is **not**
first-hand and was reconstructed at handoff time by reading the repository and `.apm/`. Specifically: Stage
3 and Stage 4 delivered production deployment, live end-to-end verification and a custom SMTP provider, and
every Stage-3/Stage-4 log on disk belongs to **infrastructure-agent**, not to this Worker. Frontend-touching
commits exist in that window (`8ebe73f` revoking a push device via query parameter, `0388252` decluttering
the notification opt-in empty state, `c4825d7` documenting Brevo SMTP) whose authorship this instance can no
longer attest to. **Treat the repository and the Task Logs as authoritative over anything in this section.**

## Working Context

- **Prove a test is not vacuous before trusting it.** This instance shipped two tests that passed against
  the bug they claimed to catch. In Task 2.16 the "does not revert the user's language" test passed even
  with the guard deleted, because the mirroring write kept the profile in agreement on the happy path; it
  was replaced with one where the PATCH fails, which isolates the guard. In Task 2.17 the sub-policy
  rejection tests were checked the same way. The method is cheap: copy the source file aside, remove the
  mechanism under test, run, restore. Do this for any test that is the sole evidence for a behavioural fix.
- **Read verdicts from the database, not the UI.** A reusable read-only harness was left at
  `<scratchpad>/check_lang.py` (profiles: email, preferred_language, onboarding_completed) and
  `check_push.py` (push_subscriptions). They read `DATABASE_URL` from `backend/.env` and run under
  `cd backend && uv run python <path>`. `psql` is **not** installed; the backend venv's `asyncpg` is the way
  in. Note `created_at` is UTC and local time is UTC+3 — this instance verified the offset before drawing a
  conclusion from a timestamp, and it mattered.
- **Forcing a language for a live test:** i18next's default detection order consults the querystring, so
  `http://localhost:5173/login?lng=en` pins detection regardless of the machine's locale. This is what made
  the cross-device language test decisive rather than dependent on the browser's own locale.
- **Aesthetic and copy decisions go to the User** via `AskUserQuestion` with ASCII previews; this instance
  used it for the switcher placement, the opt-in layout, the switcher labels, product naming and the Greek
  phrasings. Keep option previews short — a preview containing box-drawing characters once blew the tool's
  JSON payload and had to be re-sent as plain ASCII.
- **Locale parity is checked with a throwaway Python snippet** that recurses both JSONs into dotted key sets
  and diffs them. Run it after every locale edit, not just at the end. Editing the JSONs programmatically
  works well with `json.load(..., object_pairs_hook=collections.OrderedDict)` and
  `json.dump(..., ensure_ascii=False, indent=2)` plus a trailing newline; prettier normalises any residue.
- **Pre-commit hooks reformat and abort the commit.** Prettier did this once this instance: re-`git add -A`
  and re-run the identical commit. Re-run the affected tests afterwards, since the file changed.
- **Run `npm run test`, `npm run build` and `npm run lint`.** The build's `tsc -b` type-checks test files
  that Vitest does not. Two eslint rules bit this instance: `react-hooks/refs` fires when a submit handler
  closing over a ref is built during render (fix: `onSubmit={(e) => void handleSubmit(onSubmit)(e)}`), and
  React Compiler skips memoising a component that calls react-hook-form's `watch()` (fix: `useWatch`).

## Working Notes

- **i18n leaf-vs-namespace collision is real here.** `auth.password` is a leaf string, so password rule keys
  had to live at `auth.passwordPolicy.*`. Check whether a key is already a leaf before nesting under it.
- **Password policy:** `frontend/src/features/auth/password-policy.ts` is the single source —
  `PASSWORD_MIN_LENGTH = 8`, a letter (`\p{L}`) and a digit (`\p{Nd}`), deliberately Unicode-aware so a
  Greek-letter password counts. `auth-schema.ts` exports one shared `passwordField(t)` consumed by both
  signup and reset, so the two surfaces cannot drift apart again. The hosted Supabase policy enforces
  **length only** (minimum 8, both projects), so the client is deliberately *stricter* — the safe direction.
  Never let the client become looser.
- **Login errors are deliberately vague for bad credentials** (`auth-errors.ts`) so the form cannot be used
  to test which addresses are registered; only non-leaking failures are named. Do not "improve" this into
  specific messages.
- **The language switcher now writes to the account.** `PreferredLanguageSync` owns both directions:
  reconciles once per mount, applies a stored `'en'`/`'el'` over browser detection, leaves `'auto'` alone,
  and mirrors an in-app switch into the profile only when the account already stores a concrete preference.
- **Backend-composed user copy is bilingual too**, and this instance found it was the one place bypassing
  locale-aware number formatting — Greek amounts in `backend/app/services/notifications_copy.py` now use a
  comma decimal separator. The same trap awaits any future server-composed message.
- **Stale dev servers held ports 5173–5175 across several sessions and served old code.** This instance
  confirmed all three dead and freed them before the last live test; they were left free. Always confirm
  which port Vite actually took, and check the port is in the backend CORS allowlist (5173/5174/5175 are;
  4280 is not, and produces preflight 400s that look like a CSP problem but are not).
- **The backend on :8000 was already running from outside this instance** and was deliberately left alone;
  its health route is `/api/v1/health` (not `/health` — routes are under `/api/v1`).
- **`.apm/` is gitignored**, so Task Logs and bus files are never part of a commit; a commit attempt after
  writing only logs correctly reports "nothing to commit".
- Backend tests run serially against shared dev, which holds the User's real data. This instance ran only
  the affected file (`tests/test_reminders.py`) rather than the full suite three times, and flagged the
  deviation in the Task 2.14 log rather than hiding it.
