# Pre-Build Learning Resources

> **Purpose**: A curated list of resources to read/watch before starting the build. Estimated total time: **3–5 hours** if you skim, **6–8 hours** if you go deep. Don't read everything — pick what matches your gaps.

---

## Priority 1 — Must Read/Watch Before Starting

These directly affect how you'll use APM + Claude Code daily.

### 1. APM Official Docs (canonical, ~30 min)

Start here. They're the authoritative source for the framework you're using.

- **Introduction** — https://agentic-project-management.dev/docs/introduction
- **Getting Started** — https://agentic-project-management.dev/docs/getting-started
- **Quick Reference** — https://agentic-project-management.dev/docs/quick-reference
- **Agent Types** — https://agentic-project-management.dev/docs/agent-types
- **Workflow Overview** — https://agentic-project-management.dev/docs/workflow-overview
- **Tips and Tricks** — https://agentic-project-management.dev/docs/tips-and-tricks ⭐ (model selection, session management, cost optimization — read this carefully)

### 2. Claude Code Official Best Practices (~20 min)

- **Anthropic's official best practices** — https://code.claude.com/docs/en/best-practices
- **YouTube playlist (Anthropic official)** — https://www.youtube.com/playlist?list=PL-PjnjwzvkkxUHXxuohyiAuyvHXh08SFE

### 3. CLAUDE.md Deep Dive (~15 min)

`CLAUDE.md` is the persistent project context file that Claude Code reads at the start of every session. Get this right and every future session is sharper.

- **Beginner tutorial with CLAUDE.md setup** — https://codewithmukesh.com/blog/claude-code-for-beginners/
- **Community best-practices repo** (`shanraisshan/claude-code-best-practice` on GitHub) — has curated patterns for CLAUDE.md, Plan Mode, sessions, skills, and hooks

### 4. APM GitHub Repo (~15 min)

Browse the actual framework you'll use — there's no substitute for seeing the file structure:

- https://github.com/sdi2200262/agentic-project-management
- Look at: `commands/`, `skills/`, the example workflows
- README has a "Quick Start" that complements the official docs

---

## Priority 2 — Tech Stack Crash Courses

You said you don't deeply know React/TS, Tailwind, FastAPI, Docker, Azure, Chrome extensions. Skim these *before* the build so terminology isn't alien.

### Docker (~45 min — do this one, it pays off everywhere)

- **Docker official "Getting Started"** — https://docs.docker.com/get-started/
- Or any "Docker in 100 seconds" + "Docker Compose in 100 seconds" video on YouTube (Fireship)
- You only need: what an image is, what a container is, what `docker compose up` does, port mapping basics

### FastAPI (~30 min — easy since you know Python)

- **FastAPI tutorial — first user guide** — https://fastapi.tiangolo.com/tutorial/
- Read through "First Steps", "Path Parameters", "Query Parameters", "Request Body", "Dependencies"
- That's it — you'll learn the rest as you go

### Supabase (~30 min)

- **Supabase quickstart** — https://supabase.com/docs/guides/getting-started
- **Row-Level Security guide** — https://supabase.com/docs/guides/database/postgres/row-level-security ⭐ (critical for your security model)
- **Auth quickstart** — https://supabase.com/docs/guides/auth

### Tailwind + shadcn/ui (~20 min)

- **Tailwind cheat sheet** — https://nerdcave.com/tailwind-cheat-sheet (bookmark, don't memorize)
- **shadcn/ui docs** — https://ui.shadcn.com/docs (browse the components gallery so you know what's available)

### Azure (Container Apps focus, ~45 min)

- **Microsoft Learn — Container Apps fundamentals** — https://learn.microsoft.com/en-us/training/paths/build-apps-azure-container-apps/
- **Quickstart: Deploy from a registry** — https://learn.microsoft.com/en-us/azure/container-apps/quickstart-portal
- **Azure Static Web Apps quickstart** — https://learn.microsoft.com/en-us/azure/static-web-apps/getting-started
- Skip Bicep/ARM for now — you'll provision via the portal first

### Chrome Extensions Manifest V3 (~30 min)

- **Official MV3 getting started** — https://developer.chrome.com/docs/extensions/get-started
- **Service workers in MV3** — https://developer.chrome.com/docs/extensions/develop/concepts/service-workers
- Focus on: manifest.json structure, service worker lifecycle, `chrome.storage`, messaging

### Web Push API (~20 min)

- **MDN Push API guide** — https://developer.mozilla.org/en-US/docs/Web/API/Push_API
- **VAPID overview** — https://web.dev/articles/push-notifications-web-push-protocol
- You don't need deep mastery — just understand: VAPID keys, push subscription object, service worker `push` event

---

## Priority 3 — AI Engineering Patterns

You know AI theory, but applied LLM engineering has specific patterns worth seeing once.

### Groq + Function Calling (~20 min)

- **Groq tool use docs** — https://console.groq.com/docs/tool-use
- **OpenAI function calling guide** (Groq is API-compatible) — https://platform.openai.com/docs/guides/function-calling
- The OpenAI guide is more thorough; everything applies to Groq

### Streaming Responses (~15 min)

- **MDN Server-Sent Events** — https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events
- **FastAPI streaming responses** — https://fastapi.tiangolo.com/advanced/custom-response/#streamingresponse

### Single-Agent vs Multi-Agent Decision (skim)

- **Anthropic's "Building effective agents"** — https://www.anthropic.com/research/building-effective-agents (reinforces why we chose single-agent + tools, not multi-agent)

---

## Priority 4 — Optional Deep Dives

Skip unless you want to go further.

### Claude Code Mastery

- **`FlorianBruniaux/claude-code-ultimate-guide` on GitHub** — 24K+ lines of documentation, learning path, 181 templates, quizzes. If you want to become a Claude Code power user.

### APM Forks Worth Knowing About

- **`Malgenec/claude-code-agentic-project-management`** — Claude Code-optimized fork
- **`pabg92/Claude-Code-agentic-project-management`** — another active fork
- The official one (`sdi2200262/agentic-project-management`) is your primary, but these forks have additional slash commands and patterns

### Real-world Project Anatomy

Browse a similar full-stack repo for reference:

- Any "react + fastapi + supabase" template on GitHub (search the term)
- Don't copy — just see how a real repo is organized

---

## ⚡ Suggested Pre-Build Day Schedule

If you want a focused half-day to prep:

```
Hour 1: APM docs (Introduction, Getting Started, Workflow, Tips & Tricks)
Hour 2: Claude Code best practices + CLAUDE.md deep dive
Hour 3: Docker + FastAPI quickstart
Hour 4: Supabase + RLS + Auth
Hour 5: Azure Container Apps quickstart + Chrome MV3 overview
```

Then start Session 1.

---

## Things You Don't Need to Read Yet

To avoid analysis paralysis, **skip these for now**:

- ❌ Detailed React/Redux tutorials (you'll vibe code React, Zustand is simpler than Redux)
- ❌ TypeScript deep dives (pick up patterns by reading what Claude generates)
- ❌ Recharts documentation (Claude will produce charts; tweak as needed)
- ❌ Pydantic v2 docs (you know Python; the schemas will be obvious from examples)
- ❌ Bicep/Terraform (provision Azure via portal first; IaC is a future enhancement)
- ❌ Anything about microservices, Kubernetes, message queues — out of scope

---

## Mindset Going In

A few principles to internalize before you start:

1. **You will hit walls.** Especially around Azure deployment, SSE buffering, and Chrome extension auth. This is expected, not a sign you're failing.
2. **Read what Claude generates.** Even if you don't fully understand every line, skimming builds intuition. After a few weeks you'll notice yourself understanding more.
3. **One feature per session.** Don't try to do everything at once. Vertical slices over horizontal layers.
4. **Commit often.** Every working feature gets a commit. Future-you will thank present-you.
5. **APM's files are the source of truth.** Trust them. The chat is disposable; the `.apm/` folder is real.
6. **Resist scope creep.** Write new ideas in `DECISIONS.md` for "v3", don't pull them into current sessions.
7. **Ship, then polish.** A working ugly thing beats a beautiful broken thing.

Have fun building it.
