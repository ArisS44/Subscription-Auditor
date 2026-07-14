from datetime import date

import asyncpg

# These run on a plain (service-role) pooled connection, not rls_connection:
# llm_usage has only a SELECT own-row RLS policy and no write policy, so writes
# must bypass RLS. A NULL user_id addresses the app-wide daily counter row.


async def increment_daily(conn: asyncpg.Connection, user_id: str | None, day: date) -> int:
    """Atomically increment and return the request counter for one (scope, day).
    The upsert is correct under concurrent replicas: the row is created at 1 or
    incremented in a single statement. NULLS NOT DISTINCT on the unique key means
    the NULL (app-wide) scope collapses to a single row per day."""
    return await conn.fetchval(
        """
        INSERT INTO llm_usage (user_id, day, request_count)
        VALUES ($1, $2, 1)
        ON CONFLICT (user_id, day)
        DO UPDATE SET request_count = llm_usage.request_count + 1, updated_at = now()
        RETURNING request_count
        """,
        user_id,
        day,
    )


async def add_tokens(
    conn: asyncpg.Connection,
    user_id: str | None,
    day: date,
    input_tokens: int,
    output_tokens: int,
) -> None:
    """Accumulate token usage onto the (scope, day) counter row. Called after a
    model call reports usage, for both the per-user and app-wide (NULL) scopes, so
    the operator can read real token totals (and derive cost) per day. Upserts the
    same way as `increment_daily` — replica-safe, one row per (scope, day) — and
    is additive so it composes with the request-count increment done at call start.
    Never records message content: only aggregate token counts."""
    if input_tokens <= 0 and output_tokens <= 0:
        return
    await conn.execute(
        """
        INSERT INTO llm_usage (user_id, day, input_tokens, output_tokens)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (user_id, day)
        DO UPDATE SET
            input_tokens = llm_usage.input_tokens + EXCLUDED.input_tokens,
            output_tokens = llm_usage.output_tokens + EXCLUDED.output_tokens,
            updated_at = now()
        """,
        user_id,
        day,
        input_tokens,
        output_tokens,
    )
