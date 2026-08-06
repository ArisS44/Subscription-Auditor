---
agent: frontend-agent
outgoing: 1
incoming: 2
handoff: 1
stage: 2
---

# Frontend Agent Handoff 1 (Frontend Agent 1 → Frontend Agent 2)

## Summary
This instance executed a 3-Task batch (Tasks 2.1, 2.4, 2.5) in Stage 2 on branch
`feat/chat-ui-currency-captcha`. Completed 2 of 3: Task 2.5 (CAPTCHA) and Task 2.4 (currency control +
manage_url + roadmap teaser), both committed and logged with Success. Task 2.1 (Chat module) was not
started — it remains for the incoming instance, followed by the single batch report covering all three.

## Working Context

### Codebase conventions established/confirmed this instance
- Frontend lives under `frontend/src/` (not `src/`). Path alias `@/` → `frontend/src/`.
- Stack: React 19, Vite 8, TS strict, Tailwind v4, shadcn/ui on the **Base UI** (`@base-ui/react`)
  render-prop preset (NOT Radix), TanStack Query v5, react-i18next (`en`/`el`), React Router v7, Zod v4,
  react-hook-form, lucide-react, recharts.
- All backend calls go through `frontend/src/lib/api.ts::apiFetch(path, { accessToken })`, which injects
  `Authorization: Bearer <token>` and prefixes `VITE_API_BASE_URL` (`http://localhost:8000/api/v1`).
- Access token comes from `useAuth().session?.access_token` (`@/features/auth/auth-context`).
- Server state via TanStack Query hooks only. Established hook pattern: `@/hooks/useSubscriptions.ts`,
  `useAnalytics.ts`, `useMe.ts`, and the new `useFx.ts` I added — query keys fold in the access token;
  mutations invalidate a key prefix. Money/Decimal fields arrive from the API as **strings**.
- i18n: every user string keyed in BOTH `frontend/src/i18n/locales/en.json` and `el.json` (mirror
  structure). Numbers/dates/currency via `frontend/src/lib/format.ts` (`Intl`), keyed to `i18n.language`.
- Pre-commit hooks run eslint + prettier + secret detection. Prettier will reformat and abort the first
  commit if files aren't already formatted — re-stage the prettier-modified files and re-commit (this
  happened once on the 2.4 commit). Commit with explicit file paths: the repo has unrelated pre-existing
  unstaged changes (`CLAUDE.md`, `docs/DECISIONS.md`, untracked `.start-session-*.md`) that must NOT be
  included in commits.
- Commit style: Conventional Commits, no APM identifiers, Co-Authored-By trailer.

### Dev environment
- Frontend dev server: started via `cd frontend && npm run dev` → http://localhost:5173 (was running,
  HMR working; log at scratchpad `/vite-dev.log`). May need restarting in the new session.
- Backend: `cd backend && .venv/bin/uvicorn app.main:app --reload --port 8000`. IMPORTANT: the User's
  originally-running backend was a STALE process started WITHOUT `--reload` that predated the chat/FX
  routers, so `/api/v1/conversations/*` and `/api/v1/fx/*` returned 404 until restarted. It is now
  restarted WITH `--reload` and both route groups are live (verified). `uvicorn` is not on PATH — must
  use the venv path `.venv/bin/uvicorn` from the `backend/` dir.
- The User is logged in in the browser (valid session), so their token flows to authed endpoints during
  live verification.

### UX-collaboration protocol (this project)
- Visual/aesthetic choices are decided WITH the User: build the increment, then present 2–3 concrete
  options (used `AskUserQuestion` with monospace previews effectively). For Task 2.4 the User chose the
  estimate-label treatment (outline badge + Info icon + `≈` prefix + tooltip) and iterated the roadmap
  teaser copy twice (rejected AI-tool-only framing and a jokey wink; approved understated copy). The User
  asked to "not go too fast" and paused to verify CAPTCHA visually — pace deliberately, verify live, let
  them drive aesthetics.

## Working Notes
- Task 2.5: hand-rolled `frontend/src/features/auth/Turnstile.tsx` (loads CF script once, forwardRef
  `reset()`), wired into Login/Signup/ForgotPassword; token passed as `captchaToken` on
  signInWithPassword/signUp (under `options`) and resetPasswordForEmail (on its options arg). Site key
  from `VITE_TURNSTILE_SITE_KEY`, dev default = CF test key `1x00000000000000000000AA`. NOT on
  ResetPassword (updateUser is not captcha-gated) or Google OAuth. Supabase captcha ENFORCEMENT is a
  later Infra task, so the token is currently sent-but-not-verified — login still works, no regression.
- Task 2.4: added `frontend/src/hooks/useFx.ts`; currency control + estimate rendering in
  `OverviewPanel.tsx`; `manage_url` across `useSubscriptions.ts`, `subscription-schema.ts`(+test),
  `SubscriptionFormDialog.tsx`, `SubscriptionDetail.tsx`; teaser under the Overview heading (Signpost
  icon). FX conversion math: rates fetched with base=target, so amount_in_target = amount / rates[cur].
- IMPORTANT FINDING (also in Task 2.4 log + saved to Claude memory `extension-tracking-scope-broadened`):
  the User wants browser-extension usage/time tracking to cover AS MANY subscriptions as feasible, not
  AI-tools-only as the spec currently frames it. Manager should reconcile for Sessions 4-7.
- Task 2.1 (NOT STARTED) — pre-work already done this instance: read the backend contract in full
  (`backend/app/routers/chat.py`, `backend/app/models/chat.py`). SSE frames are `data: {json}\n\n` with
  `type` in {delta, tool, structured, title, error, done}. Must consume via `fetch` + ReadableStream
  reader (NOT EventSource — can't send the bearer header/POST body); reuse apiFetch for auth. Endpoints:
  GET/POST/DELETE `/conversations`, GET `/conversations/{id}/messages`, POST
  `/conversations/{id}/messages` (SSE). DOMPurify is NOT yet a dependency — 2.1 needs `dompurify` +
  a markdown parser (`marked`) added; sanitize markdown with a tag allowlist before rendering, never raw
  HTML; structured payloads render via typed components (their real renderers are Task 2.2's job — for
  2.1 just capture/attach the structured event to the message). Swap the Chat route in
  `frontend/src/App.tsx` from `ComingSoonPage` to the real module, and remove `placeholder: true` from
  the chat entry in `frontend/src/features/dashboard/nav-items.ts`. 2.1 has UX gates (bubble styling,
  sidebar layout, empty-state) to present as options.
