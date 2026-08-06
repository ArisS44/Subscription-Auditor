# Development Process Documentation

This folder is the working record of how this application was built. It was not written for
presentation — it is the actual coordination state the process ran on, published afterwards
without rewriting. Expect working notes, corrections, and abandoned approaches; those are the
parts worth reading.

The application was developed across four sessions using **Agentic Project Management (APM)**, a
framework for coordinating multiple AI coding agents against a plan. APM is an open-source
methodology by [@sdi2200262](https://github.com/sdi2200262) —
[agentic-project-management](https://github.com/sdi2200262/agentic-project-management), v1.0.2 —
used here with thanks. The framework's own files are not included in this repository; everything
here is project-specific content produced while using it.

**[`index.md`](index.md) lists every session** with its date, scope, and stage and task counts.
That is the fastest way in.

---

## How the process works

Rather than prompting a single assistant repeatedly, the work is split across agents with distinct
roles and no shared memory. Each runs in its own context window and communicates through files.

| Role | Responsibility |
|---|---|
| **Planner** | Turns requirements into a Spec and a Plan — the Stage and Task breakdown. Runs once per session. |
| **Manager** | Coordinates. Writes Task Prompts, reviews returned work, verifies claims independently, merges branches, maintains state. Does not implement. |
| **Workers** | Execute one Task at a time within a single domain. This project used three: Backend & Data, Frontend, and Infrastructure & Deployment. |

A Worker receives only its Task Prompt — never the Spec, Plan, or Tracker. Anything it needs must
be written into the prompt by the Manager. This keeps agents focused, and it means a prompt that
omits context produces work that misses it. Several instances of exactly that are recorded in the
logs.

Work flows in one cycle, repeated: **the Manager writes a Task Prompt → a Worker executes it on a
feature branch → the Worker writes a Task Log → the Manager reviews it, verifies the claims against
the codebase, and merges.**

When an agent approaches its context limit, it performs a **Handoff** — writing a structured log so
a fresh instance can resume. Those logs sit under each session's `memory/handoffs/`, and they are
candid about what the outgoing instance knew and what it had already got wrong.

---

## The human role

The process is agent-executed but not agent-directed. Across these sessions the human work was:

- **Architecture and technology decisions** — stack, data model, the security and privacy
  constraints in [`CLAUDE.md`](../../CLAUDE.md), and the deliberate exclusions recorded in each Spec.
- **Scope and task decomposition** — approving or reshaping the Stage/Task breakdown, deciding what
  ships and what defers at session boundaries.
- **Review and acceptance** — every Task was verified before being accepted, and live/manual
  verification repeatedly caught defects that passing test suites did not.
- **Domain judgment** — Greek translation quality, UX decisions, and product calls the agents were
  explicitly not permitted to settle alone.

The logs record this as a working relationship rather than a clean one. Agents corrected the
Manager's Task Prompts on several occasions and were right to; a number of Tasks exist only because
hands-on testing found something no test covered.

---

## Layout

Each session is a self-contained folder with the same structure:

```
<session-name>/
├── spec.md              Design decisions, constraints, and explicit out-of-scope list
├── plan.md              Stage/Task breakdown with per-Task validation criteria
├── tracker.md           Coordination state: Task status, Working Notes, VC conventions
├── session-summary.md   What the session delivered, written at close
└── memory/
    ├── index.md         Durable observations + per-Stage summaries
    ├── stage-NN/        One log per Task: what was done, verified, and found
    └── handoffs/        Context transfers when an agent instance was replaced
```

A session still in progress lives at the repository's `.apm/` root instead, in the same shape, and
moves here when it closes.

## Reading order

If you have five minutes, pick a session from [`index.md`](index.md) and read in this order:

1. **`spec.md`** — what the session set out to build, and what it deliberately excluded.
2. **`plan.md`** — the Task breakdown. Each Task carries an Objective, Output, Validation criteria,
   Guidance, and Dependencies. This is where task decomposition is visible.
3. **`tracker.md`** — coordination state, and **Working Notes**, which is the densest material
   here: open decisions, accepted gaps, and constraints written for whoever picks the project up
   next.
4. **`session-summary.md`** — the session's outcome in prose.
5. **Any single task log** under `memory/stage-NN/` — these are where the engineering reasoning
   lives: the mechanism chosen, the alternatives rejected and why, and what was verified rather
   than assumed.

---

## Related documents

- [`../../docs/`](../../docs/README.md) — the engineering documentation: full specification,
  standards, decision log, and ADRs. The Specs and Task briefs here reference it constantly as the
  authoritative source.
- [`../../CLAUDE.md`](../../CLAUDE.md) — the standing instruction file every agent operated under.
  Human-authored, and the most direct artifact of process direction: the security, privacy,
  layering, testing, and review rules were enforced from here on every Task, and rules were added
  to it as the build surfaced new failure modes.

---

## Caveats

- **"the User"** throughout means the repository owner. The documents are written by agents,
  addressing the human operator in the third person.
- **Task Logs are self-reported.** They record what an agent believed it had done. The Manager's
  independent verification is recorded separately in the Tracker and Stage summaries — where the
  two disagree, the disagreement is left visible rather than reconciled.
- **Dates are internal to the project timeline** and reflect session sequence.
- Agent message-bus transport files, worktree scratch space, per-session run-books, and the
  framework's own guides are excluded; they are mechanism, not process.
