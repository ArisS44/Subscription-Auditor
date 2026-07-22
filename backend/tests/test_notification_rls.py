import uuid
from collections.abc import AsyncIterator

import asyncpg
import pytest

from app.db.pool import get_pool
from app.db.rls import rls_connection
from app.deps import verify_token

# Real-DB security tests for the notification/guidance schema, mirroring
# test_rls.py / test_chat_rls.py. Two things are proven here that cannot be
# established by reading the migration:
#   1. Cross-user denial on the two user-scoped tables (push_subscriptions,
#      notification_deliveries) — RLS is the second wall behind Pydantic and is
#      verified, never assumed.
#   2. That notification_deliveries' unique constraint actually rejects a
#      duplicate claim. The entire idempotency design of the scheduled reminder
#      job rests on that constraint, so it is asserted directly rather than
#      trusted.
# Inline SQL (not db-layer helpers) keeps these tests from pre-empting the db
# modules later tasks will own; the security structure is what matters here.


async def _insert_subscription(conn: asyncpg.Connection, user_id: str) -> uuid.UUID:
    row = await conn.fetchrow(
        "INSERT INTO subscriptions (user_id, name, price, billing_cycle, start_date) "
        "VALUES ($1, 'Test Service', 9.99, 'monthly', CURRENT_DATE) RETURNING id",
        user_id,
    )
    return row["id"]


@pytest.fixture
async def seeded_guide(db_pool) -> AsyncIterator[str]:
    """Insert one service_guides row the way curation will: through a pooled
    connection with no `authenticated` role set, which bypasses RLS the same way
    the backend service role does. Users have no write path to this table, so a
    test cannot seed it as a user."""
    service_key = f"test-guide-{uuid.uuid4().hex[:12]}"
    pool = get_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO service_guides (service_key, display_name, cancel_url) "
            "VALUES ($1, 'Test Guide', 'https://example.com/cancel')",
            service_key,
        )
    yield service_key
    async with pool.acquire() as conn:
        await conn.execute("DELETE FROM service_guides WHERE service_key = $1", service_key)


async def test_cross_user_push_subscription_denied_by_rls(db_pool, user_a, user_b):
    a_id, token_a = user_a
    _, token_b = user_b
    claims_a = verify_token(token_a)
    claims_b = verify_token(token_b)

    async with rls_connection(claims_a) as conn:
        row = await conn.fetchrow(
            "INSERT INTO push_subscriptions (user_id, endpoint, p256dh_key, auth_key) "
            "VALUES ($1, $2, 'p256dh-a', 'auth-a') RETURNING id",
            a_id,
            f"https://push.example.com/{uuid.uuid4().hex}",
        )
    sub_id = row["id"]

    # Owner can read their own device registration.
    async with rls_connection(claims_a) as conn:
        assert (
            await conn.fetchrow("SELECT id FROM push_subscriptions WHERE id = $1", sub_id)
            is not None
        )

    # Non-owner cannot read it, and cannot modify or delete it — all three match
    # zero rows under RLS, so RETURNING comes back empty. A leak here would mean
    # one user could read another's push credential and send them notifications.
    async with rls_connection(claims_b) as conn:
        assert (
            await conn.fetchrow("SELECT id FROM push_subscriptions WHERE id = $1", sub_id) is None
        )
        assert (
            await conn.fetchrow(
                "UPDATE push_subscriptions SET auth_key = 'hijacked' WHERE id = $1 RETURNING id",
                sub_id,
            )
            is None
        )
        assert (
            await conn.fetchrow("DELETE FROM push_subscriptions WHERE id = $1 RETURNING id", sub_id)
            is None
        )

    # A's row is untouched by B's attempts.
    async with rls_connection(claims_a) as conn:
        still = await conn.fetchrow("SELECT auth_key FROM push_subscriptions WHERE id = $1", sub_id)
    assert still is not None and still["auth_key"] == "auth-a"


async def test_cross_user_notification_delivery_denied_by_rls(db_pool, user_a, user_b):
    a_id, token_a = user_a
    _, token_b = user_b
    claims_a = verify_token(token_a)
    claims_b = verify_token(token_b)

    async with rls_connection(claims_a) as conn:
        subscription_id = await _insert_subscription(conn, a_id)
        row = await conn.fetchrow(
            "INSERT INTO notification_deliveries (user_id, subscription_id, kind, due_date) "
            "VALUES ($1, $2, 'renewal_reminder', CURRENT_DATE) RETURNING id",
            a_id,
            subscription_id,
        )
    delivery_id = row["id"]

    async with rls_connection(claims_a) as conn:
        assert (
            await conn.fetchrow("SELECT id FROM notification_deliveries WHERE id = $1", delivery_id)
            is not None
        )

    # B cannot see A's ledger, nor delete rows from it. Deletion matters as much
    # as reading: erasing a ledger row would un-claim a notification and let it
    # be sent again.
    async with rls_connection(claims_b) as conn:
        assert (
            await conn.fetchrow("SELECT id FROM notification_deliveries WHERE id = $1", delivery_id)
            is None
        )
        assert (
            await conn.fetchrow(
                "UPDATE notification_deliveries SET kind = 'monthly_review' "
                "WHERE id = $1 RETURNING id",
                delivery_id,
            )
            is None
        )
        assert (
            await conn.fetchrow(
                "DELETE FROM notification_deliveries WHERE id = $1 RETURNING id", delivery_id
            )
            is None
        )

    async with rls_connection(claims_a) as conn:
        assert (
            await conn.fetchrow("SELECT id FROM notification_deliveries WHERE id = $1", delivery_id)
            is not None
        )


async def test_duplicate_delivery_claim_rejected_by_unique_constraint(db_pool, user_a):
    """The idempotency guarantee, asserted directly against the database.

    The scheduled job inserts here *before* sending. A second invocation — a
    cron retry, a manual re-run, an overlapping replica — must be rejected by
    Postgres rather than by an application-level check, which would race.
    """
    a_id, token_a = user_a
    claims_a = verify_token(token_a)

    async with rls_connection(claims_a) as conn:
        subscription_id = await _insert_subscription(conn, a_id)

    async with rls_connection(claims_a) as conn:
        await conn.execute(
            "INSERT INTO notification_deliveries (user_id, subscription_id, kind, due_date) "
            "VALUES ($1, $2, 'renewal_reminder', DATE '2026-08-01')",
            a_id,
            subscription_id,
        )

    # Same (user_id, subscription_id, kind, due_date) — must be rejected.
    with pytest.raises(asyncpg.exceptions.UniqueViolationError):
        async with rls_connection(claims_a) as conn:
            await conn.execute(
                "INSERT INTO notification_deliveries (user_id, subscription_id, kind, due_date) "
                "VALUES ($1, $2, 'renewal_reminder', DATE '2026-08-01')",
                a_id,
                subscription_id,
            )

    # A different due_date is a different notification and must still be allowed,
    # otherwise the constraint would suppress legitimate future reminders.
    async with rls_connection(claims_a) as conn:
        await conn.execute(
            "INSERT INTO notification_deliveries (user_id, subscription_id, kind, due_date) "
            "VALUES ($1, $2, 'renewal_reminder', DATE '2026-09-01')",
            a_id,
            subscription_id,
        )
        count = await conn.fetchval(
            "SELECT count(*) FROM notification_deliveries WHERE subscription_id = $1",
            subscription_id,
        )
    assert count == 2


async def test_duplicate_subscriptionless_claim_rejected(db_pool, user_a):
    """`unique nulls not distinct` is what makes the constraint hold for the
    account-wide notification kinds, where subscription_id is NULL. Under
    Postgres' default NULLS DISTINCT, NULL != NULL and both rows would be
    accepted — the deduplication would silently not apply to exactly the case
    it is needed for."""
    a_id, token_a = user_a
    claims_a = verify_token(token_a)

    async with rls_connection(claims_a) as conn:
        await conn.execute(
            "INSERT INTO notification_deliveries (user_id, kind, due_date) "
            "VALUES ($1, 'monthly_review', DATE '2026-08-01')",
            a_id,
        )

    with pytest.raises(asyncpg.exceptions.UniqueViolationError):
        async with rls_connection(claims_a) as conn:
            await conn.execute(
                "INSERT INTO notification_deliveries (user_id, kind, due_date) "
                "VALUES ($1, 'monthly_review', DATE '2026-08-01')",
                a_id,
            )


async def test_service_guides_readable_but_not_writable_by_users(db_pool, user_a, seeded_guide):
    """Global reference data: any signed-in user reads it, no user may write it.
    The read is permitted by a single authenticated-select policy; the writes
    are refused because no insert/update/delete policy exists at all and RLS
    denies by default."""
    _, token_a = user_a
    claims_a = verify_token(token_a)

    async with rls_connection(claims_a) as conn:
        row = await conn.fetchrow(
            "SELECT display_name FROM service_guides WHERE service_key = $1", seeded_guide
        )
        assert row is not None and row["display_name"] == "Test Guide"

    # INSERT with no policy raises outright (the row violates RLS)...
    with pytest.raises(asyncpg.exceptions.InsufficientPrivilegeError):
        async with rls_connection(claims_a) as conn:
            await conn.execute(
                "INSERT INTO service_guides (service_key, display_name) VALUES ($1, 'Injected')",
                f"injected-{uuid.uuid4().hex[:12]}",
            )

    # ...while UPDATE and DELETE with no policy simply match zero rows, so they
    # affect nothing. Both outcomes are denial; only the shape differs.
    async with rls_connection(claims_a) as conn:
        assert (
            await conn.fetchrow(
                "UPDATE service_guides SET cancel_url = 'https://evil.example.com' "
                "WHERE service_key = $1 RETURNING id",
                seeded_guide,
            )
            is None
        )
        assert (
            await conn.fetchrow(
                "DELETE FROM service_guides WHERE service_key = $1 RETURNING id", seeded_guide
            )
            is None
        )

    async with rls_connection(claims_a) as conn:
        still = await conn.fetchrow(
            "SELECT cancel_url FROM service_guides WHERE service_key = $1", seeded_guide
        )
    assert still is not None and still["cancel_url"] == "https://example.com/cancel"


async def test_reminder_lead_days_defaults_to_null_and_accepts_override(db_pool, user_a):
    """NULL means "inherit profiles.renewal_lead_days", which is why no backfill
    was needed — a subscription created without the column set is already
    correct."""
    a_id, token_a = user_a
    claims_a = verify_token(token_a)

    async with rls_connection(claims_a) as conn:
        subscription_id = await _insert_subscription(conn, a_id)
        assert (
            await conn.fetchval(
                "SELECT reminder_lead_days FROM subscriptions WHERE id = $1", subscription_id
            )
            is None
        )

        # An explicit override is accepted, and resolution prefers it over the
        # profile default.
        await conn.execute(
            "UPDATE subscriptions SET reminder_lead_days = 7 WHERE id = $1", subscription_id
        )
        effective = await conn.fetchval(
            "SELECT coalesce(s.reminder_lead_days, p.renewal_lead_days) "
            "FROM subscriptions s JOIN profiles p ON p.id = s.user_id WHERE s.id = $1",
            subscription_id,
        )
        assert effective == 7

        # Clearing it falls back to the profile default (3).
        await conn.execute(
            "UPDATE subscriptions SET reminder_lead_days = NULL WHERE id = $1", subscription_id
        )
        effective = await conn.fetchval(
            "SELECT coalesce(s.reminder_lead_days, p.renewal_lead_days) "
            "FROM subscriptions s JOIN profiles p ON p.id = s.user_id WHERE s.id = $1",
            subscription_id,
        )
        assert effective == 3

    # Out-of-range values are refused by the CHECK constraint.
    with pytest.raises(asyncpg.exceptions.CheckViolationError):
        async with rls_connection(claims_a) as conn:
            await conn.execute(
                "UPDATE subscriptions SET reminder_lead_days = 99 WHERE id = $1", subscription_id
            )
