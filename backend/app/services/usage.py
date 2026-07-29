"""Chat usage caps. All three are enforced before any LLM work happens, and a
breach returns a reason the chat service maps to a graceful degraded response —
never a 500. The daily caps are DB-backed (llm_usage) so they're correct across
horizontally-scaled replicas; the per-minute velocity window reads the user's own
recent messages.
"""

from datetime import date

from app.config import settings
from app.db import chat as chat_db
from app.db import usage as usage_db
from app.db.pool import get_pool
from app.db.rls import rls_connection

# Reasons returned to the chat service (which maps them to user-facing copy).
CAP_VELOCITY = "rate"
CAP_USER_DAILY = "user_daily"
CAP_GLOBAL_DAILY = "global_daily"

_VELOCITY_WINDOW_SECONDS = 60


async def enforce_caps(claims: dict) -> str | None:
    """Return a cap-breach reason, or None if the request may proceed. Increments
    the daily counters as part of the check (an attempt counts), so this must be
    called exactly once per user message before the LLM is engaged."""
    user_id = claims["sub"]

    # Per-user velocity: how many messages this user sent in the last minute.
    async with rls_connection(claims) as conn:
        recent = await chat_db.recent_user_message_count(
            conn, user_id, seconds=_VELOCITY_WINDOW_SECONDS
        )
    if recent >= settings.chat_user_per_minute:
        return CAP_VELOCITY

    # Daily caps via the DB-backed counters (service role bypasses llm_usage RLS,
    # which is read-own-only). Increment-and-check under concurrency. Both scopes
    # are incremented in one statement rather than two sequential ones: this is on
    # the chat request path, so the saved round-trip is user-visible latency.
    #
    # Consequence of batching, deliberate: a message that breaches the *user* cap
    # now also increments the app-wide counter, where previously the second
    # increment was skipped. Both counters already count attempts rather than
    # successful LLM calls (the increment happens before any model work), so this
    # stays consistent with what they mean — it only makes the app-wide counter
    # include user-capped attempts too.
    today = date.today()
    pool = get_pool()
    async with pool.acquire() as conn:
        user_count, app_count = await usage_db.increment_daily_both(conn, user_id, today)
    if user_count > settings.chat_user_daily_cap:
        return CAP_USER_DAILY
    if app_count > settings.chat_global_daily_cap:
        return CAP_GLOBAL_DAILY
    return None


async def record_token_usage(user_id: str, input_tokens: int, output_tokens: int) -> None:
    """Persist token usage for the day onto both the per-user and app-wide counters
    (the request count was already incremented in `enforce_caps`). Best-effort
    observability for the operator's private usage report — never fails the turn.
    Aggregate counts only; no message content is stored."""
    if input_tokens <= 0 and output_tokens <= 0:
        return
    today = date.today()
    pool = get_pool()
    async with pool.acquire() as conn:
        await usage_db.add_tokens_both(conn, user_id, today, input_tokens, output_tokens)
