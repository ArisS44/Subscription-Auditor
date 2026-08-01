import re
from collections.abc import AsyncIterator
from datetime import date, timedelta
from decimal import Decimal

import pytest

from app.config import settings
from app.db import reminders as reminders_db
from app.db.pool import get_pool
from app.services import reminders as engine
from app.services.notifications_copy import render_renewal_reminder, resolve_language
from app.services.subscription import compute_next_renewal_date

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
    # `advanced` reports the renewal dates rolled forward this run. It defaults to
    # 0 so existing constructors still work, but it is part of the response shape.
    assert r.json() == {
        "advanced": 0,
        "due": 0,
        "sent": 0,
        "skipped_already_sent": 0,
        "pruned": 0,
        "failed": 0,
    }


# --------------------------------------------------------------------------
# Bounded work on the job path.
#
# `run-due` is externally triggerable and already caps the subscriptions it
# scans, but that cap was only as good as the work each scanned row could
# trigger: every device fanned out to becomes an encrypted request to a push
# service. The device read is now bounded per user too.
#
# The cap is monkeypatched down rather than creating 101 real rows — this suite
# runs against shared dev, and the behaviour under test is "the LIMIT is applied
# and applied deterministically", which a cap of 2 demonstrates exactly as well.
# --------------------------------------------------------------------------
async def test_job_device_fanout_is_bounded_per_user(db_pool, user_a, monkeypatch):
    uid, _ = user_a
    for i in range(3):
        await _add_device(uid, f"https://push.example.com/bounded-{i}")
    assert await _device_count(uid) == 3

    monkeypatch.setattr(reminders_db, "_MAX_DEVICES_PER_USER", 2)
    pool = get_pool()
    async with pool.acquire() as conn:
        rows = await reminders_db.get_active_push_subscriptions(conn, user_id=uid)
    assert len(rows) == 2, "the job read more devices than its per-user ceiling"


async def test_job_device_fanout_keeps_a_deterministic_order(db_pool, user_a, monkeypatch):
    """A LIMIT without an ORDER BY makes *which* devices survive the cap
    arbitrary, so the same user could get a reminder on a different device each
    run. Oldest-first, tie-broken by id."""
    uid, _ = user_a
    for i in range(3):
        await _add_device(uid, f"https://push.example.com/ordered-{i}")

    pool = get_pool()
    monkeypatch.setattr(reminders_db, "_MAX_DEVICES_PER_USER", 2)
    async with pool.acquire() as conn:
        first = [
            r["endpoint"]
            for r in await reminders_db.get_active_push_subscriptions(conn, user_id=uid)
        ]
        second = [
            r["endpoint"]
            for r in await reminders_db.get_active_push_subscriptions(conn, user_id=uid)
        ]
    assert first == second
    assert first == ["https://push.example.com/ordered-0", "https://push.example.com/ordered-1"]


# --------------------------------------------------------------------------
# Rolling renewal dates forward.
#
# `next_renewal_date` was written once at create/update and never again, so the
# moment a renewal passed, the due-query's `>= CURRENT_DATE` filter dropped that
# subscription permanently — one reminder per subscription, ever, then silence.
#
# The advance is global, like the rest of the job, so `isolate_renewal_dates`
# snapshots and restores every row it could touch. Without it these tests would
# permanently rewrite the developer's own overdue subscriptions on shared dev.
# --------------------------------------------------------------------------
@pytest.fixture
async def isolate_renewal_dates(db_pool) -> AsyncIterator[None]:
    """Restore next_renewal_date for every row the global advance could move."""
    pool = get_pool()
    async with pool.acquire() as conn:
        before = [
            (r["id"], r["next_renewal_date"])
            for r in await conn.fetch(
                "SELECT id, next_renewal_date FROM subscriptions "
                "WHERE status = 'active' AND next_renewal_date < CURRENT_DATE"
            )
        ]
    yield
    if before:
        async with pool.acquire() as conn:
            await conn.execute(
                """
                UPDATE subscriptions AS s SET next_renewal_date = v.d
                FROM (SELECT unnest($1::uuid[]) AS id, unnest($2::date[]) AS d) AS v
                WHERE s.id = v.id
                """,
                [b[0] for b in before],
                [b[1] for b in before],
            )


async def _run_advance() -> int:
    pool = get_pool()
    async with pool.acquire() as conn:
        return await engine.advance_past_renewal_dates(conn)


async def _renewal_date(sub_id: str) -> date:
    pool = get_pool()
    async with pool.acquire() as conn:
        return await conn.fetchval(
            "SELECT next_renewal_date FROM subscriptions WHERE id = $1::uuid", sub_id
        )


async def test_past_renewal_date_is_advanced_to_the_next_future_date(
    db_pool, user_a, isolate_renewal_dates
):
    uid, _ = user_a
    sub_id = await _insert_subscription(user_id=uid, renewal_offset_days=-5)
    stale = await _renewal_date(sub_id)
    assert stale < date.today(), "precondition: the subscription starts overdue"

    await _run_advance()

    rolled = await _renewal_date(sub_id)
    assert rolled > date.today(), "the stored date is still in the past"
    assert rolled == compute_next_renewal_date(stale, "monthly", date.today())


async def test_several_elapsed_cycles_advance_in_one_step(db_pool, user_a, isolate_renewal_dates):
    """A subscription unvisited for months must land on its next *future* date, not
    creep one cycle per run — otherwise a lapsed yearly subscription would need a
    year of daily runs to catch up."""
    uid, _ = user_a
    sub_id = await _insert_subscription(user_id=uid, renewal_offset_days=-100)
    stale = await _renewal_date(sub_id)

    await _run_advance()
    rolled = await _renewal_date(sub_id)

    assert rolled > date.today()
    # One monthly step from the stale date would still be in the past — proving
    # the helper walked multiple cycles rather than adding a single one.
    one_step = compute_next_renewal_date(stale, "monthly", stale)
    assert one_step < date.today()
    # And it did not overshoot: the result is within one cycle of today.
    assert (rolled - date.today()).days <= 31


async def test_a_renewal_falling_today_is_not_advanced(db_pool, user_a, isolate_renewal_dates):
    """The whole hazard of advancing before due-detection. A renewal dated today is
    still live for today's reminder (the due-query accepts `>= CURRENT_DATE`), so
    moving it would silently skip that reminder entirely."""
    uid, _ = user_a
    sub_id = await _insert_subscription(user_id=uid, renewal_offset_days=0)
    assert await _renewal_date(sub_id) == date.today()

    await _run_advance()

    assert await _renewal_date(sub_id) == date.today(), "today's renewal was advanced away"


async def test_running_the_advance_twice_does_not_skip_a_cycle(
    db_pool, user_a, isolate_renewal_dates
):
    """External triggers get retried and re-dispatched; a second run in the same
    day must be a no-op, not another cycle forward."""
    uid, _ = user_a
    sub_id = await _insert_subscription(user_id=uid, renewal_offset_days=-5)

    await _run_advance()
    after_first = await _renewal_date(sub_id)
    await _run_advance()
    after_second = await _renewal_date(sub_id)

    assert after_first == after_second


@pytest.mark.parametrize("bad_status", ["cancelled", "paused"])
async def test_inactive_subscriptions_are_never_advanced(
    db_pool, user_a, isolate_renewal_dates, bad_status
):
    """Neither is billing, so moving the date would assert a future charge that is
    not coming. They remain suppressed from reminders regardless."""
    uid, _ = user_a
    sub_id = await _insert_subscription(user_id=uid, renewal_offset_days=-5, status=bad_status)
    stale = await _renewal_date(sub_id)

    await _run_advance()

    assert await _renewal_date(sub_id) == stale
    assert sub_id not in await _due_ids()


async def test_advanced_subscription_earns_a_new_reminder_while_the_old_one_stays_claimed(
    db_pool, user_a, isolate_renewal_dates, isolate_deliveries
):
    """The case the ledger key was designed for. Advancing yields a different
    due_date, which legitimately earns its own reminder, while the existing row
    still prevents re-sending the old one."""
    uid, _ = user_a
    await _set_profile_lead(uid, 30)
    sub_id = await _insert_subscription(user_id=uid, renewal_offset_days=-1, lead_days=30)
    stale = await _renewal_date(sub_id)

    # Simulate the reminder that already went out for the now-past date.
    pool = get_pool()
    async with pool.acquire() as conn:
        assert await reminders_db.claim_delivery(
            conn, user_id=uid, subscription_id=sub_id, due_date=stale
        )

    await _run_advance()
    rolled = await _renewal_date(sub_id)
    assert rolled > date.today()

    # Back in the due set — for the NEW date, which is what the job will claim.
    assert sub_id in await _due_ids()

    async with pool.acquire() as conn:
        # The new date is claimable: a different key, so a legitimate new reminder.
        assert await reminders_db.claim_delivery(
            conn, user_id=uid, subscription_id=sub_id, due_date=rolled
        )
        # The old date is still claimed, so it can never be re-sent.
        assert not await reminders_db.claim_delivery(
            conn, user_id=uid, subscription_id=sub_id, due_date=stale
        )


async def test_every_billing_cycle_the_schema_allows_is_handled(db_pool):
    """Anti-drift: the DB CHECK on billing_cycle and the renewal calculation must
    agree. Adding a cycle to the constraint without teaching the helper would make
    the job raise mid-run for every user, so this reads the allowed values out of
    the live constraint rather than restating them."""
    pool = get_pool()
    async with pool.acquire() as conn:
        definition = await conn.fetchval("""
            SELECT pg_get_constraintdef(con.oid) FROM pg_constraint con
            JOIN pg_class rel ON rel.oid = con.conrelid
            WHERE rel.relname = 'subscriptions' AND con.contype = 'c'
              AND pg_get_constraintdef(con.oid) LIKE '%billing_cycle%'
            """)
    cycles = re.findall(r"'([a-z]+)'::text", definition)
    assert set(cycles) == {"weekly", "monthly", "quarterly", "yearly"}, cycles
    today = date.today()
    for cycle in cycles:
        result = compute_next_renewal_date(today - timedelta(days=400), cycle, today)
        assert result > today, f"{cycle} did not produce a future date"
