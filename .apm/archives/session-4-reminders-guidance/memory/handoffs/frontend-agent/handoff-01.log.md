---
agent: frontend-agent
outgoing: 1
incoming: 2
handoff: 1
stage: 2
---

# Frontend Agent Handoff 1 (Frontend Agent 1 → Frontend Agent 2)

## Summary
Instance 1 completed **five Tasks** across two Stages: Stage 1 — Task 1.2 (Onboarding First-Login Fix) and Task 1.4 (Apollon Mark & Icon Set); Stage 2 — Task 2.4 (Service Worker, PWA & Opt-In, **Partial** — iOS on-device check outstanding), Task 2.5 (Notification Settings & Lead Time, Success), and Task 2.9 (Strict Frontend CSP, Success). Current Stage is 2. All Task Logs written; all work committed to its per-Task branch (never merged — Manager merges).

## Working Context
- **TanStack Query conventions**: every backend call goes through `frontend/src/lib/api.ts::apiFetch` with the session access token; hooks live in `src/hooks/`. Mutations that change `['me']` must `setQueryData(['me', accessToken], profile)` **then** invalidate — bare invalidation was the root of the onboarding double-wizard bug (Task 1.2). Query keys fold the access token in so switching accounts refetches.
- **i18n en/el at exact parity is enforced.** I verified parity every task with a small Python script (recurse both locale JSONs into dotted key sets and diff). New user-facing copy always needs both `en` and `el`. Backend-composed user text is bilingual too.
- **Live verification is the real acceptance test** and repeatedly caught what jsdom could not (onboarding flash, the push opt-in reload bug). Pattern: start backend `cd backend && uv run uvicorn app.main:app --port 8000 --reload`; start frontend `cd frontend && npm run dev` (Vite → :5173); poll health/`curl` until 200; hand the User precise steps with the browser console open; wait for their result.
- **Visual/aesthetic choices are decided WITH the User** (project rule). Used `AskUserQuestion` with ASCII previews for the lead-time control and the iOS surface; used a published Artifact to compare Apollon mark directions. Never settle aesthetics unilaterally.
- **Pre-commit hooks reformat files** (prettier, eslint, end-of-file). A commit often fails once because a hook modifies a file — re-`git add` the touched files and re-run the same commit. eslint here is strict: no inner components created during render, no synchronous `setState` in an effect body (async in `.then` is fine).
- **`npm run build` (tsc -b) type-checks test files; `npm run test` (Vitest) does not.** Run both before considering any test-file change done. Hit a real TS 5.7 `Uint8Array<ArrayBuffer>` narrowing error on `applicationServerKey` that only the build caught.

## Working Notes
- **Apollon identity (Task 1.4):** the app mark is the Noun Project "apollo" (CC BY 3.0) — attribution is a shipping requirement (Settings credit + repo `NOTICE`). Apollo figure ≥96px; an original monochrome sun glyph below 96px (favicon, notification badge). In-app rendering via `src/components/ApollonMark.tsx` (CSS mask over `/apollon.svg`, paints in currentColor). Icons under `frontend/public/icons/`.
- **Web Push (Tasks 2.4/2.5):** SW is hand-authored `frontend/public/sw.js` (no `vite-plugin-pwa`, ADR 0004 — no fetch/Cache handler so it never serves stale assets). Opt-in `NotificationOptIn` is in onboarding AND Settings. "Enabled" is derived from whether this browser's push subscription endpoint is in the backend device list (`GET /push/subscriptions`), not a session flag — this fixed a reload bug. **iOS on-device push is still unverified** (needs HTTPS + Home-Screen install; User has no iPhone → confirm on the deployed build).
- **Reminder model:** per-user default `renewal_lead_days` (PATCH /me); per-subscription `reminder_lead_days` nullable (null = inherit). Only ONE reminder per sub — User asked about multiple; that needs a backend change (flagged to Manager).
- **CSP (Task 2.9):** strict policy in `frontend/public/staticwebapp.config.json` `globalHeaders`. The Vite dev server does NOT apply it; to enforce locally I served built `dist` through a scratch static server (`scratchpad/csp-server.mjs`) that copies `globalHeaders` onto responses — run it on a port the backend CORS allowlist trusts (**5173/5174/5175**, NOT 4280, or preflights 400). `connect-src` lists dev AND prod origins (prod API `ca-subscription-auditor-backend.nicebush-826aba8d.germanywestcentral.azurecontainerapps.io`, prod Supabase `ylwjevannrlsauegwbas.supabase.co`). Only relaxation: `style-src 'unsafe-inline'` (Recharts/UI inline styles).
- **Cross-surface finding flagged to Manager (Task 2.5):** the Apollon chatbot edited a subscription with a fabricated value and a fuzzy name match without confirming — chat/LLM surface, not this Worker's tasks.
- **Background-command "failed exit 143/144" notifications** are just the dev servers responding to `pkill` (SIGTERM) — expected, not errors.
- **Memories updated** under the project memory dir: apollon-identity-and-icon-set, push-optin-state, chatbot-ungrounded-subscription-edit, frontend-csp (+ MEMORY.md index).
