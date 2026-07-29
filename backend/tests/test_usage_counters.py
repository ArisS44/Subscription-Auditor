"""The batched daily-usage counters.

`increment_daily_both` and `add_tokens_both` write the per-user row AND the
app-wide (NULL `user_id`) row in a single statement, replacing two sequential
round-trips on the chat request path. Nothing else in the suite asserts the
app-wide row, so a statement that silently stopped writing it — the exact
failure a hand-written multi-row upsert invites — would leave every other test
green. These tests exist to make that failure visible.

The app-wide row is genuinely global: it aggregates every account on this
database, including real ones. Each test therefore captures its prior values and
restores them afterwards rather than deleting the row, following the same
"restore what you mutate" discipline as the reminder-job tests.
"""

from contextlib import asynccontextmanager
from datetime import date

from app.db import usage as usage_db
from app.db.pool import get_pool

_APP_ROW = (
    "SELECT request_count, input_tokens, output_tokens FROM llm_usage "
    "WHERE user_id IS NULL AND day = $1"
)
_USER_ROW = (
    "SELECT request_count, input_tokens, output_tokens FROM llm_usage "
    "WHERE user_id = $1 AND day = $2"
)


@asynccontextmanager
async def _app_row_restored(conn, day):
    """Yield the app-wide counter row as it was, and put it back afterwards."""
    before = await conn.fetchrow(_APP_ROW, day)
    try:
        yield before
    finally:
        if before is None:
            await conn.execute("DELETE FROM llm_usage WHERE user_id IS NULL AND day = $1", day)
        else:
            await conn.execute(
                "UPDATE llm_usage SET request_count = $1, input_tokens = $2, "
                "output_tokens = $3 WHERE user_id IS NULL AND day = $4",
                before["request_count"],
                before["input_tokens"],
                before["output_tokens"],
                day,
            )


async def test_increment_daily_both_moves_user_and_app_counters(db_pool, user_a):
    """One statement must advance both scopes — and the returned pair must be the
    values actually stored, since the caps are enforced against what it returns."""
    user_id, _ = user_a
    today = date.today()
    async with get_pool().acquire() as conn:
        async with _app_row_restored(conn, today) as before_app:
            app_before = before_app["request_count"] if before_app else 0

            user_count, app_count = await usage_db.increment_daily_both(conn, user_id, today)

            stored_user = await conn.fetchrow(_USER_ROW, user_id, today)
            stored_app = await conn.fetchrow(_APP_ROW, today)

            # The per-user row is created at 1 (the shared user is reset per test).
            assert stored_user is not None, "per-user counter row was not written"
            assert stored_user["request_count"] == 1
            assert user_count == 1

            # The app-wide row really moved — this is the assertion no other test
            # makes, and the one that fails if the NULL branch stops being written.
            assert stored_app is not None, "app-wide counter row was not written"
            assert stored_app["request_count"] == app_before + 1
            assert app_count == app_before + 1

        await conn.execute("DELETE FROM llm_usage WHERE user_id = $1 AND day = $2", user_id, today)


async def test_add_tokens_both_accumulates_on_user_and_app_counters(db_pool, user_a):
    """Token totals are additive on both scopes, and compose with an existing row
    rather than replacing it (the request count is incremented first, in
    `enforce_caps`, so these must not clobber each other)."""
    user_id, _ = user_a
    today = date.today()
    async with get_pool().acquire() as conn:
        async with _app_row_restored(conn, today) as before_app:
            app_in = before_app["input_tokens"] if before_app else 0
            app_out = before_app["output_tokens"] if before_app else 0

            # Establish the request-count row first, exactly as a real turn does.
            await usage_db.increment_daily_both(conn, user_id, today)
            await usage_db.add_tokens_both(conn, user_id, today, 100, 20)
            await usage_db.add_tokens_both(conn, user_id, today, 5, 3)

            stored_user = await conn.fetchrow(_USER_ROW, user_id, today)
            stored_app = await conn.fetchrow(_APP_ROW, today)

            assert stored_user["input_tokens"] == 105
            assert stored_user["output_tokens"] == 23
            # The request count set up beforehand survived the token writes.
            assert stored_user["request_count"] == 1

            assert stored_app["input_tokens"] == app_in + 105
            assert stored_app["output_tokens"] == app_out + 23

        await conn.execute("DELETE FROM llm_usage WHERE user_id = $1 AND day = $2", user_id, today)


async def test_add_tokens_both_ignores_an_empty_update(db_pool, user_a):
    """A turn that reported no usage must not create counter rows for either
    scope — the guard is what keeps a failed turn out of the spend report."""
    user_id, _ = user_a
    today = date.today()
    async with get_pool().acquire() as conn:
        async with _app_row_restored(conn, today) as before_app:
            await usage_db.add_tokens_both(conn, user_id, today, 0, 0)

            assert await conn.fetchrow(_USER_ROW, user_id, today) is None
            after_app = await conn.fetchrow(_APP_ROW, today)
            if before_app is None:
                assert after_app is None
            else:
                assert after_app["input_tokens"] == before_app["input_tokens"]
