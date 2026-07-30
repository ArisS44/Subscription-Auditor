"""Database-level constraints on the profile lead-time columns.

These deliberately bypass the API. Driving `PATCH /me` would prove only that
Pydantic rejects a bad value — it would pass identically with no constraint on
the table at all, which was the actual state before this migration. So every
test here writes straight to Postgres on a raw connection (service role, no RLS
in the way) so that the *only* thing able to reject the write is the constraint
itself.

The pairing matters: `ProfileResponse` declares both columns non-nullable, and
the reminder engine resolves `COALESCE(s.reminder_lead_days, p.renewal_lead_days)`
— so a NULL or out-of-range value here would surface as a 500 on GET /me or as a
nonsensical reminder window, neither of which the API layer can prevent on its
own.
"""

import re

import asyncpg
import pytest

from app.config import settings
from app.models.common import LEAD_DAYS_MAX, LEAD_DAYS_MIN

_SET_LEAD = "UPDATE profiles SET renewal_lead_days = $1 WHERE id = $2"


@pytest.fixture
async def raw_conn():
    """A direct connection, outside the app pool and outside RLS. Using the app's
    rls_connection would leave doubt about whether RLS or the constraint did the
    rejecting; this removes that ambiguity."""
    conn = await asyncpg.connect(dsn=settings.database_url)
    try:
        yield conn
    finally:
        await conn.close()


async def test_database_rejects_an_out_of_range_lead_time(raw_conn, user_a):
    """The CHECK, not Pydantic, is what refuses these."""
    user_id, _ = user_a
    for bad in (LEAD_DAYS_MAX + 1, LEAD_DAYS_MIN - 1, 999, -50):
        with pytest.raises(asyncpg.exceptions.CheckViolationError) as exc:
            await raw_conn.execute(_SET_LEAD, bad, user_id)
        assert "profiles_renewal_lead_days_check" in str(exc.value)


async def test_database_accepts_the_boundary_values(raw_conn, user_a):
    """The bound is inclusive at both ends — a check that rejected everything
    would also pass the test above, so prove the valid range still writes."""
    user_id, _ = user_a
    for good in (LEAD_DAYS_MIN, LEAD_DAYS_MAX, 7):
        await raw_conn.execute(_SET_LEAD, good, user_id)
        stored = await raw_conn.fetchval(
            "SELECT renewal_lead_days FROM profiles WHERE id = $1", user_id
        )
        assert stored == good


async def test_database_rejects_a_null_lead_time(raw_conn, user_a):
    """NULL has no meaning here: it is the value a subscription's own NULL falls
    back to, so there would be nothing left to resolve to."""
    user_id, _ = user_a
    with pytest.raises(asyncpg.exceptions.NotNullViolationError):
        await raw_conn.execute(_SET_LEAD, None, user_id)


async def test_database_rejects_a_null_monthly_review_flag(raw_conn, user_a):
    """`ProfileResponse.monthly_review_enabled` is a bare bool, so a NULL would
    fail response validation and turn GET /me into a 500."""
    user_id, _ = user_a
    with pytest.raises(asyncpg.exceptions.NotNullViolationError):
        await raw_conn.execute(
            "UPDATE profiles SET monthly_review_enabled = NULL WHERE id = $1", user_id
        )


async def test_the_two_walls_state_the_same_bound(raw_conn):
    """Pydantic and the database must agree, or one of them is decoration.

    Reads the bound out of the live constraint definition and compares it to the
    shared `LeadDays` limits, so changing either side without the other fails
    here rather than silently allowing a value one wall accepts and the other
    rejects. Also asserts the profile and subscription constraints match — the
    subscription override falls back to the profile default, so a value the
    override could never hold must not be reachable as the default."""
    defs = dict(await raw_conn.fetch("""
            SELECT con.conname, pg_get_constraintdef(con.oid)
            FROM pg_constraint con JOIN pg_class rel ON rel.oid = con.conrelid
            WHERE con.contype = 'c'
              AND con.conname IN ('profiles_renewal_lead_days_check',
                                  'subscriptions_reminder_lead_days_check')
            """))
    assert set(defs) == {
        "profiles_renewal_lead_days_check",
        "subscriptions_reminder_lead_days_check",
    }, f"a lead-time CHECK is missing: {sorted(defs)}"

    for name, definition in defs.items():
        bounds = [int(n) for n in re.findall(r"-?\d+", definition)]
        assert bounds == [LEAD_DAYS_MIN, LEAD_DAYS_MAX], f"{name} states {bounds}"
