# Project Documentation

Engineering documentation for the Subscription Auditor: what the system is, how it is built, and
the constraints it is built under.

This is distinct from [`.apm/`](../.apm/archives/README.md), which records *how the work was carried out* —
task briefs, agent logs, and review notes. If you want the system, read here. If you want the
process, read there.

| Document | What it is |
|---|---|
| [`APP_DESCRIPTION.md`](APP_DESCRIPTION.md) | The full specification — features, architecture, data model, and API surface. The authoritative description of what the application does. |
| [`ENGINEERING_STANDARDS.md`](ENGINEERING_STANDARDS.md) | Non-negotiable standards the implementation must meet: scalability and modularity, security, privacy/GDPR. Referenced by every task brief. |
| [`DECISIONS.md`](DECISIONS.md) | Chronological log of cross-cutting decisions, each with its reasoning and the tradeoff accepted. Includes decisions later reversed, with why. |
| [`APM_SESSIONS.md`](APM_SESSIONS.md) | The roadmap — how the build is divided into independently deployable sessions, and what lands in each. |
| [`adr/`](adr/) | Architecture Decision Records for choices needing more room than a log entry. |
| [`LEARNING_LOG.md`](LEARNING_LOG.md) | Per-session record of concepts encountered while building, with pointers into the code. The project doubles as a learning exercise in an unfamiliar stack. |
| [`LEARNING_RESOURCES.md`](LEARNING_RESOURCES.md) | Curated references for the technologies used. |

## Architecture Decision Records

| ADR | Decision |
|---|---|
| [0001](adr/0001-jwt-verification-via-jwks-es256.md) | JWT verification via JWKS (ES256) |
| [0002](adr/0002-provider-agnostic-llm-layer-over-httpx.md) | Provider-agnostic LLM layer over `httpx` |
| [0003](adr/0003-lazy-refresh-fx-cache-no-scheduler.md) | Lazy-refresh FX cache, no scheduler |
| [0004](adr/0004-hand-authored-service-worker.md) | Hand-authored service worker |

## Related

- [`../CLAUDE.md`](../CLAUDE.md) — the standing instruction file the AI agents operated under.
  Human-authored, and the mechanism by which the standards above were enforced on every task.
- [`../.apm/archives/README.md`](../.apm/archives/README.md) — the development process record.
