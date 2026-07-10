# ADR 0003: Lazy-refresh FX rate cache instead of a scheduled job

## Status
Accepted

## Context
The Overview offers an opt-in currency-conversion view (always labeled an estimate), which needs
reasonably current FX rates. Rates change at most daily (the source, Frankfurter, wraps ECB
reference rates). The obvious way to keep a cache warm is a scheduled job that refreshes rates on a
timer.

But this backend is stateless and horizontally scalable, and "how to run a scheduler safely across
replicas without double-firing" is a known hard problem the engineering standards explicitly defer to
a later session (the reminder scheduler). Introducing APScheduler or any background runner now would
pull that unsolved problem forward for a feature that does not need it.

## Decision
No scheduler. Cache rates in the existing `fx_rates` table with a 12-hour staleness TTL
(`fetched_at`) and refresh **lazily**: on a conversion request, if the cached rate for the needed base
is fresh, serve it with no external call; if stale or missing, fetch fresh rates for that base from
Frankfurter in one call, upsert every pair via a service-role connection (bypassing the read-only
RLS), then serve. On a source failure, fall back to the last-known-good cached rates; only a cold
cache with a down source returns an error (503).

## Consequences
- Zero background infrastructure and no cross-replica coordination — any replica can refresh on demand,
  and the upsert-on-conflict is idempotent, so concurrent refreshes converge on the same row.
- Worst case, one user request occasionally pays the latency of a single upstream fetch (~once per 12h
  per base). Acceptable for an opt-in estimate; if it ever matters, a warm-up call can be added without
  changing the model.
- Staleness is bounded by the TTL, and an upstream outage degrades to stale-but-served rather than a
  hard failure — the right trade-off for non-authoritative estimate data.
- The fixed provider host is not user-supplied, so there is no SSRF surface here; this must not be
  generalized into fetching arbitrary hosts.
- When the reminder scheduler lands in a later session, its single-owner mechanism could optionally
  pre-warm popular bases, but the lazy path remains the correctness guarantee.
