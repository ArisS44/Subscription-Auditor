from collections.abc import AsyncIterator
from datetime import date
from decimal import Decimal

import pytest

from app.config import settings
from app.db import reminders as reminders_db
from app.db.pool import get_pool
from app.services import reminders as engine
from app.services.notifications_copy import render_renewal_reminder, resolve_language

BASE = "/api/v1/jobs"

# NOTE ON TESTING A GLOBALLY-SCOPED JOB AGAINST SHARED DEV:
# run_due_reminders() scans every user by design, and the shared dev database
# holds other accounts' real subscriptions. So these tests never assert on the
# job's *global* counts — they assert on the test user's own subscription:
# whether it appears in the due set, whether exactly one ledger row and one send
# result for it. The endpoint-aware spy returns the test outcome only for the test
# user's own endpoint and DELIVERED for everyone else, so no real user's device is
# ever pruned. `isolate_deliveries` restores notification_deliveries to its
# pre-test state, removing any ledger rows the engine wrote for other users.


# --------------------------------------------------------------------------
# Seeding helpers (service-role pool, mirroring how the job reads/writes)
# --------------------------------------------------------------------------
async def _insert_subscription(
    *, user_id: str, renewal_offset_days: int, status: str = "active", lead_days: int | None = None
) -> str:
    pool = get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            INSERT INTO subscriptions
              (user_id, name, price, currency, billing_cycle, start_date,
               next_renewal_date, status, reminder_lead_days)
            VALUES ($1, 'Claude Pro', 20.00, 'USD', 'monthly', CURRENT_DATE,
                    CURRENT_DATE + $2::int, $3, $4)
            RETURNING id
            """,
            user_id,
            renewal_offset_days,
            status,
            lead_days,
        )
    return str(row["id"])


async def _set_profile_lead(user_id: str, lead_days: int) -> None:
    pool = get_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            "UPDATE profiles SET renewal_lead_days = $2 WHERE id = $1", user_id, lead_days
        )


async def _add_device(user_id: str, endpoint: str) -> None:
    pool = get_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO push_subscriptions (user_id, endpoint, p256dh_key, auth_key) "
            "VALUES ($1, $2, 'p256dh', 'auth')",
            user_id,
            endpoint,
        )


async def _due_ids(limit: int = 1000) -> set[str]:
    pool = get_pool()
    async with pool.acquire() as conn:
        rows = await reminders_db.get_due_reminders(conn, limit=limit)
    return {str(r["id"]) for r in rows}


async def _ledger_count(user_id: str, subscription_id: str) -> int:
    pool = get_pool()
    async with pool.acquire() as conn:
        return await conn.fetchval(
            "SELECT count(*) FROM notification_deliveries "
            "WHERE user_id = $1 AND subscription_id = $2",
            user_id,
            subscription_id,
        )


async def _device_count(user_id: str) -> int:
    pool = get_pool()
    async with pool.acquire() as conn:
        return await conn.fetchval(
            "SELECT count(*) FROM push_subscriptions WHERE user_id = $1", user_id
        )


class _SpySend:
    """Endpoint-aware channel.send stand-in: returns the mapped outcome for a
    specific endpoint and DELIVERED for every other (so real users' devices are
    never pruned by a test). Records the endpoints it was called with."""

    def __init__(self, outcome_for: dict | None = None):
        self.calls: list[str] = []
        self.outcome_for = outcome_for or {}

    async def __call__(self, *, endpoint, p256dh, auth, payload_json):
        self.calls.append(endpoint)
        return self.outcome_for.get(endpoint, engine.DeliveryOutcome.DELIVERED)


@pytest.fixture
async def isolate_deliveries(db_pool) -> AsyncIterator[None]:
    """Restore notification_deliveries to its pre-test state, removing any rows the
    global engine wrote for OTHER users during the test. Only deletes rows that did
    not exist before the test, so pre-existing dev data is untouched."""
    pool = get_pool()
    async with pool.acquire() as conn:
        before = {r["id"] for r in await conn.fetch("SELECT id FROM notification_deliveries")}
    yield
    async with pool.acquire() as conn:
        rows = await conn.fetch("SELECT id FROM notification_deliveries")
        new_ids = [r["id"] for r in rows if r["id"] not in before]
        if new_ids:
            await conn.execute(
                "DELETE FROM notification_deliveries WHERE id = ANY($1::uuid[])", new_ids
            )


# --------------------------------------------------------------------------
# Due detection (non-mutating: membership in the due set)
# --------------------------------------------------------------------------
async def test_due_within_lead_window_is_detected(db_pool, user_a):
    uid, _ = user_a
    await _set_profile_lead(uid, 3)
    sub_id = await _insert_subscription(user_id=uid, renewal_offset_days=2)  # inside window
    assert sub_id in await _due_ids()


async def test_renewal_outside_lead_window_is_not_due(db_pool, user_a):
    uid, _ = user_a
    await _set_profile_lead(uid, 3)
    sub_id = await _insert_subscription(user_id=uid, renewal_offset_days=10)  # outside window
    assert sub_id not in await _due_ids()


async def test_renewal_already_passed_is_not_due(db_pool, user_a):
    uid, _ = user_a
    await _set_profile_lead(uid, 3)
    sub_id = await _insert_subscription(user_id=uid, renewal_offset_days=-1)  # already past
    assert sub_id not in await _due_ids()


# --------------------------------------------------------------------------
# Lead-time precedence — both directions
# --------------------------------------------------------------------------
async def test_subscription_override_takes_precedence(db_pool, user_a):
    uid, _ = user_a
    await _set_profile_lead(uid, 1)  # profile default alone would exclude a 5-day-out renewal
    sub_id = await _insert_subscription(user_id=uid, renewal_offset_days=5, lead_days=7)
    assert sub_id in await _due_ids()  # override (7) wins over profile default (1)


async def test_null_override_falls_back_to_profile_default(db_pool, user_a):
    uid, _ = user_a
    await _set_profile_lead(uid, 7)
    sub_id = await _insert_subscription(user_id=uid, renewal_offset_days=5, lead_days=None)
    assert sub_id in await _due_ids()  # NULL inherits profile default (7)


async def test_null_override_not_due_when_profile_default_tight(db_pool, user_a):
    uid, _ = user_a
    await _set_profile_lead(uid, 2)
    sub_id = await _insert_subscription(user_id=uid, renewal_offset_days=5, lead_days=None)
    assert sub_id not in await _due_ids()  # NULL inherits a default (2) that excludes it


# --------------------------------------------------------------------------
# Suppression
# --------------------------------------------------------------------------
@pytest.mark.parametrize("bad_status", ["cancelled", "paused"])
async def test_cancelled_and_paused_produce_no_reminder(db_pool, user_a, bad_status):
    uid, _ = user_a
    await _set_profile_lead(uid, 5)
    sub_id = await _insert_subscription(user_id=uid, renewal_offset_days=2, status=bad_status)
    assert sub_id not in await _due_ids()


# --------------------------------------------------------------------------
# Idempotency — the behaviour that matters most
# --------------------------------------------------------------------------
async def test_double_run_sends_exactly_once(db_pool, user_a, isolate_deliveries, monkeypatch):
    uid, _ = user_a
    await _set_profile_lead(uid, 5)
    sub_id = await _insert_subscription(user_id=uid, renewal_offset_days=2)
    endpoint = "https://push.example.com/mine"
    await _add_device(uid, endpoint)
    spy = _SpySend()
    monkeypatch.setattr(engine.channel, "send", spy)

    await engine.run_due_reminders()
    await engine.run_due_reminders()

    # Exactly one send to my device and exactly one ledger row across both runs —
    # the second run found the claim already in the ledger and skipped it.
    assert spy.calls.count(endpoint) == 1
    assert await _ledger_count(uid, sub_id) == 1


async def test_claim_delivery_is_idempotent_at_db_level(db_pool, user_a, isolate_deliveries):
    """The mechanism directly: the first claim wins, the second hits the unique
    constraint and reports no insert."""
    uid, _ = user_a
    sub_id = await _insert_subscription(user_id=uid, renewal_offset_days=2)
    pool = get_pool()
    async with pool.acquire() as conn:
        first = await reminders_db.claim_delivery(
            conn, user_id=uid, subscription_id=sub_id, due_date=date(2026, 9, 1)
        )
        second = await reminders_db.claim_delivery(
            conn, user_id=uid, subscription_id=sub_id, due_date=date(2026, 9, 1)
        )
    assert first is True and second is False


# --------------------------------------------------------------------------
# Delivery classification within the job's own orchestration
# --------------------------------------------------------------------------
async def test_expired_device_is_pruned(db_pool, user_a, isolate_deliveries, monkeypatch):
    uid, _ = user_a
    await _set_profile_lead(uid, 5)
    await _insert_subscription(user_id=uid, renewal_offset_days=2)
    endpoint = "https://push.example.com/dead"
    await _add_device(uid, endpoint)
    # Only my endpoint reports gone; everyone else's stays DELIVERED (not pruned).
    monkeypatch.setattr(
        engine.channel,
        "send",
        _SpySend({endpoint: engine.DeliveryOutcome.EXPIRED}),
    )

    await engine.run_due_reminders()
    assert await _device_count(uid) == 0  # my dead device was pruned


async def test_transient_failure_retains_device(db_pool, user_a, isolate_deliveries, monkeypatch):
    uid, _ = user_a
    await _set_profile_lead(uid, 5)
    await _insert_subscription(user_id=uid, renewal_offset_days=2)
    endpoint = "https://push.example.com/mine"
    await _add_device(uid, endpoint)
    monkeypatch.setattr(
        engine.channel,
        "send",
        _SpySend({endpoint: engine.DeliveryOutcome.FAILED}),
    )

    await engine.run_due_reminders()
    assert await _device_count(uid) == 1  # transient failure does not prune


# --------------------------------------------------------------------------
# Copy rendering
# --------------------------------------------------------------------------
def test_copy_renders_en_el_and_auto_defaults_english():
    args = dict(
        name="Netflix", price=Decimal("9.99"), currency="EUR", renewal_date=date(2026, 8, 1)
    )
    en = render_renewal_reminder("en", **args)
    el = render_renewal_reminder("el", **args)
    auto = render_renewal_reminder("auto", **args)

    assert en.title == "Upcoming renewal" and "Netflix" in en.body and "9.99" in en.body
    assert el.title == "Επερχόμενη ανανέωση" and "Netflix" in el.body
    # Each language uses its own decimal separator, as the frontend's Intl
    # formatting does: Greek writes 9,99 where English writes 9.99.
    assert "9,99" in el.body and "9.99" not in el.body
    # Greek leads with "Η συνδρομή" instead of putting a gendered article on an
    # arbitrary subscription name.
    assert el.body.startswith("Η συνδρομή Netflix")
    assert auto.model_dump() == en.model_dump()  # auto → English
    assert resolve_language("auto") == "en" and resolve_language("el") == "el"


# --------------------------------------------------------------------------
# Job endpoint authentication — uniform, fail-closed, constant-time
# --------------------------------------------------------------------------
def test_run_due_rejects_missing_wrong_and_malformed_identically(test_client, monkeypatch):
    monkeypatch.setattr(settings, "job_token", "the-real-secret-token")

    missing = test_client.post(f"{BASE}/run-due")
    wrong = test_client.post(f"{BASE}/run-due", headers={"X-Job-Token": "nope"})
    malformed = test_client.post(f"{BASE}/run-due", headers={"X-Job-Token": ""})

    for r in (missing, wrong, malformed):
        assert r.status_code == 401
        assert r.json() == {"detail": "Unauthorized"}
    assert missing.json() == wrong.json() == malformed.json()


def test_run_due_fails_closed_when_token_unset(test_client, monkeypatch):
    monkeypatch.setattr(settings, "job_token", "")
    r = test_client.post(f"{BASE}/run-due", headers={"X-Job-Token": "anything"})
    assert r.status_code == 401 and r.json() == {"detail": "Unauthorized"}
    empty = test_client.post(f"{BASE}/run-due", headers={"X-Job-Token": ""})
    assert empty.status_code == 401


def test_run_due_accepts_correct_token(test_client, monkeypatch):
    monkeypatch.setattr(settings, "job_token", "the-real-secret-token")

    async def _noop():
        from app.models.jobs import JobRunResult

        return JobRunResult(due=0, sent=0, skipped_already_sent=0, pruned=0, failed=0)

    # Keep this auth-focused test off the DB.
    monkeypatch.setattr("app.routers.jobs.run_due_reminders", _noop)
    r = test_client.post(f"{BASE}/run-due", headers={"X-Job-Token": "the-real-secret-token"})
    assert r.status_code == 200
    assert r.json() == {"due": 0, "sent": 0, "skipped_already_sent": 0, "pruned": 0, "failed": 0}
