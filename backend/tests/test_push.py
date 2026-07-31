import pytest
from pywebpush import WebPushException

from app.config import settings
from app.db import push as push_db
from app.db.rls import rls_connection
from app.deps import verify_token
from app.middleware.rate_limit import _storage
from app.services import push as push_svc

BASE = "/api/v1/push"


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _sub_body(endpoint: str = "https://push.example.com/device-1", **overrides) -> dict:
    body = {
        "endpoint": endpoint,
        "keys": {
            # Realistic base64url shapes (content is never decoded in these tests).
            "p256dh": "BEl" + "A" * 84,
            "auth": "c2VjcmV0" + "A" * 16,
        },
        "user_agent": "Chrome on laptop",
    }
    body.update(overrides)
    return body


class _FakeResponse:
    """Stand-in for the requests.Response attached to a WebPushException."""

    def __init__(self, status_code: int) -> None:
        self.status_code = status_code


# --------------------------------------------------------------------------
# Subscribe / unsubscribe
# --------------------------------------------------------------------------
def test_subscribe_persists_scoped_to_caller(test_client, user_a):
    user_id, token = user_a
    r = test_client.post(f"{BASE}/subscribe", headers=_auth(token), json=_sub_body())
    assert r.status_code == 201
    body = r.json()
    assert body["endpoint"] == "https://push.example.com/device-1"
    assert body["user_agent"] == "Chrome on laptop"
    # The encryption keys are never echoed back on the response surface.
    assert "keys" not in body and "p256dh" not in body and "auth" not in body


async def test_subscribe_is_owned_by_caller_in_db(db_pool, user_a):
    user_id, token = user_a
    claims = verify_token(token)
    payload = push_svc.PushSubscriptionCreate(**_sub_body())
    await push_svc.subscribe(claims, payload)

    async with rls_connection(claims) as conn:
        rows = await push_db.list_subscriptions(conn)
    assert len(rows) == 1
    # Under RLS the row is only visible because it belongs to the caller.
    assert rows[0]["endpoint"] == "https://push.example.com/device-1"


def test_repeat_subscribe_same_endpoint_upserts(test_client, user_a):
    _, token = user_a
    first = test_client.post(f"{BASE}/subscribe", headers=_auth(token), json=_sub_body())
    assert first.status_code == 201

    # Same endpoint, rotated keys and new label — must update in place, not add.
    updated = _sub_body(user_agent="Firefox on phone")
    updated["keys"]["auth"] = "cm90YXRlZA" + "B" * 14
    second = test_client.post(f"{BASE}/subscribe", headers=_auth(token), json=updated)
    assert second.status_code == 201
    assert second.json()["user_agent"] == "Firefox on phone"

    listed = test_client.get("/api/v1/me", headers=_auth(token))  # warm the token/session
    assert listed.status_code in (200, 429)


async def test_repeat_subscribe_does_not_duplicate_row(db_pool, user_a):
    _, token = user_a
    claims = verify_token(token)
    await push_svc.subscribe(claims, push_svc.PushSubscriptionCreate(**_sub_body()))
    await push_svc.subscribe(claims, push_svc.PushSubscriptionCreate(**_sub_body()))

    async with rls_connection(claims) as conn:
        rows = await push_db.list_subscriptions(conn)
    assert len(rows) == 1  # the upsert collapsed the two onto one (user_id, endpoint)


def test_unsubscribe_removes_row(test_client, user_a):
    _, token = user_a
    endpoint = "https://push.example.com/device-1"
    test_client.post(f"{BASE}/subscribe", headers=_auth(token), json=_sub_body(endpoint))

    r = test_client.delete(f"{BASE}/subscribe", params={"endpoint": endpoint}, headers=_auth(token))
    assert r.status_code == 204

    # A second delete finds nothing → 404 (existence not leaked, same as a
    # never-existent endpoint).
    again = test_client.delete(
        f"{BASE}/subscribe", params={"endpoint": endpoint}, headers=_auth(token)
    )
    assert again.status_code == 404


def test_unsubscribe_unknown_endpoint_is_404(test_client, user_a):
    _, token = user_a
    r = test_client.delete(
        f"{BASE}/subscribe",
        params={"endpoint": "https://push.example.com/never"},
        headers=_auth(token),
    )
    assert r.status_code == 404


def test_subscribe_rejects_non_http_endpoint(test_client, user_a):
    _, token = user_a
    r = test_client.post(
        f"{BASE}/subscribe",
        headers=_auth(token),
        json=_sub_body(endpoint="javascript:alert(1)"),
    )
    assert r.status_code == 422


# --------------------------------------------------------------------------
# Device list endpoint
# --------------------------------------------------------------------------
def test_list_devices_returns_callers_devices_without_keys(test_client, user_a):
    _, token = user_a
    test_client.post(f"{BASE}/subscribe", headers=_auth(token), json=_sub_body())
    test_client.post(
        f"{BASE}/subscribe",
        headers=_auth(token),
        json=_sub_body(endpoint="https://push.example.com/device-2", user_agent="Firefox on phone"),
    )

    r = test_client.get(f"{BASE}/subscriptions", headers=_auth(token))
    assert r.status_code == 200
    devices = r.json()
    assert len(devices) == 2
    assert {d["endpoint"] for d in devices} == {
        "https://push.example.com/device-1",
        "https://push.example.com/device-2",
    }
    for d in devices:
        # Identifiable enough for Settings to label and revoke a device...
        assert d["endpoint"] and d["id"] and d["created_at"]
        assert "user_agent" in d
        # ...but the encryption keys are absent, under every name they go by.
        for forbidden in ("p256dh", "auth", "p256dh_key", "auth_key", "keys"):
            assert forbidden not in d, f"{forbidden} must never reach this response"


def test_list_devices_requires_auth(test_client):
    assert test_client.get(f"{BASE}/subscriptions").status_code == 401


def test_list_devices_is_empty_before_any_subscribe(test_client, user_a):
    _, token = user_a
    r = test_client.get(f"{BASE}/subscriptions", headers=_auth(token))
    assert r.status_code == 200
    assert r.json() == []  # an empty collection, not a 404


def test_subscribe_list_revoke_round_trip(test_client, user_a):
    """Revocation must be revocable in fact: after DELETE the row is gone from the
    list, not merely flagged or muted."""
    _, token = user_a
    endpoint = "https://push.example.com/device-1"
    assert (
        test_client.post(
            f"{BASE}/subscribe", headers=_auth(token), json=_sub_body(endpoint=endpoint)
        ).status_code
        == 201
    )

    listed = test_client.get(f"{BASE}/subscriptions", headers=_auth(token)).json()
    assert [d["endpoint"] for d in listed] == [endpoint]

    assert (
        test_client.delete(
            f"{BASE}/subscribe", params={"endpoint": endpoint}, headers=_auth(token)
        ).status_code
        == 204
    )

    assert test_client.get(f"{BASE}/subscriptions", headers=_auth(token)).json() == []


def test_list_devices_does_not_show_another_users_device(test_client, user_a, user_b):
    """B's list must not contain A's device. The positive control comes first: A's
    own list proves the row exists, so B's empty list is a real denial rather than
    a query that matched nothing."""
    _, token_a = user_a
    _, token_b = user_b
    test_client.post(f"{BASE}/subscribe", headers=_auth(token_a), json=_sub_body())

    # Positive control — the row genuinely exists and is visible to its owner.
    a_devices = test_client.get(f"{BASE}/subscriptions", headers=_auth(token_a)).json()
    assert [d["endpoint"] for d in a_devices] == ["https://push.example.com/device-1"]

    b_devices = test_client.get(f"{BASE}/subscriptions", headers=_auth(token_b)).json()
    assert b_devices == []
    assert "https://push.example.com/device-1" not in [d["endpoint"] for d in b_devices]

    # A's row survived B's read.
    assert len(test_client.get(f"{BASE}/subscriptions", headers=_auth(token_a)).json()) == 1


def test_list_response_model_has_no_key_fields() -> None:
    """Structural, not behavioural: even if the query were changed to select the
    keys, the response model has no field able to carry them. Guards the invariant
    at the type level rather than relying on a request-shaped test."""
    from app.models.push import PushSubscriptionResponse

    fields = set(PushSubscriptionResponse.model_fields)
    assert fields.isdisjoint({"p256dh", "auth", "p256dh_key", "auth_key", "keys"})
    assert fields == {"id", "endpoint", "user_agent", "created_at"}


# --------------------------------------------------------------------------
# Cross-user isolation (with positive control)
# --------------------------------------------------------------------------
async def test_cross_user_cannot_see_or_delete(db_pool, user_a, user_b):
    a_id, token_a = user_a
    _, token_b = user_b
    claims_a = verify_token(token_a)
    claims_b = verify_token(token_b)

    await push_svc.subscribe(claims_a, push_svc.PushSubscriptionCreate(**_sub_body()))

    # Positive control: A genuinely has the row (so the denial below is meaningful,
    # not vacuous).
    async with rls_connection(claims_a) as conn:
        assert len(await push_db.list_subscriptions(conn)) == 1

    # B sees none of A's rows and cannot delete A's endpoint.
    async with rls_connection(claims_b) as conn:
        assert len(await push_db.list_subscriptions(conn)) == 0
        deleted = await push_db.delete_by_endpoint(conn, "https://push.example.com/device-1")
    assert deleted is None

    # A's row survived B's attempt.
    async with rls_connection(claims_a) as conn:
        assert len(await push_db.list_subscriptions(conn)) == 1


# --------------------------------------------------------------------------
# Sender failure classification (pywebpush mocked at the boundary)
# --------------------------------------------------------------------------
async def test_gone_status_prunes_subscription(db_pool, user_a, monkeypatch):
    _, token = user_a
    claims = verify_token(token)
    await push_svc.subscribe(claims, push_svc.PushSubscriptionCreate(**_sub_body()))

    def _raise_gone(*args, **kwargs):
        raise WebPushException("gone", response=_FakeResponse(410))

    monkeypatch.setattr(push_svc, "webpush", _raise_gone)

    result = await push_svc.deliver_to_user(
        claims, push_svc.NotificationPayload(title="t", body="b")
    )
    assert result.total == 1 and result.pruned == 1 and result.sent == 0 and result.failed == 0

    # The dead row was deleted.
    async with rls_connection(claims) as conn:
        assert len(await push_db.list_subscriptions(conn)) == 0


async def test_transient_failure_retains_subscription(db_pool, user_a, monkeypatch):
    _, token = user_a
    claims = verify_token(token)
    await push_svc.subscribe(claims, push_svc.PushSubscriptionCreate(**_sub_body()))

    def _raise_500(*args, **kwargs):
        raise WebPushException("server error", response=_FakeResponse(500))

    monkeypatch.setattr(push_svc, "webpush", _raise_500)

    result = await push_svc.deliver_to_user(
        claims, push_svc.NotificationPayload(title="t", body="b")
    )
    assert result.total == 1 and result.failed == 1 and result.pruned == 0

    # The row is left in place — a transient failure is not a reason to prune.
    async with rls_connection(claims) as conn:
        assert len(await push_db.list_subscriptions(conn)) == 1


async def test_timeout_failure_retains_subscription(db_pool, user_a, monkeypatch):
    _, token = user_a
    claims = verify_token(token)
    await push_svc.subscribe(claims, push_svc.PushSubscriptionCreate(**_sub_body()))

    def _raise_timeout(*args, **kwargs):
        raise TimeoutError("network timeout")

    monkeypatch.setattr(push_svc, "webpush", _raise_timeout)

    result = await push_svc.deliver_to_user(
        claims, push_svc.NotificationPayload(title="t", body="b")
    )
    assert result.failed == 1 and result.pruned == 0

    async with rls_connection(claims) as conn:
        assert len(await push_db.list_subscriptions(conn)) == 1


async def test_send_passes_positive_ttl_so_offline_devices_are_not_dropped(
    db_pool, user_a, monkeypatch
):
    """A TTL must reach the push service, or a device asleep at send time drops the
    reminder entirely (pywebpush's default ttl=0 means 'deliver now or discard')."""
    _, token = user_a
    claims = verify_token(token)
    await push_svc.subscribe(claims, push_svc.PushSubscriptionCreate(**_sub_body()))

    captured = {}

    def _capture(*args, **kwargs):
        captured.update(kwargs)
        return "ok"

    monkeypatch.setattr(push_svc, "webpush", _capture)
    await push_svc.deliver_to_user(claims, push_svc.NotificationPayload(title="t", body="b"))

    assert captured.get("ttl", 0) > 0
    assert captured["ttl"] == settings.push_ttl_seconds


async def test_fanout_is_best_effort_across_devices(db_pool, user_a, monkeypatch):
    """One dead endpoint does not abort delivery to the others: a mix of a 410
    (prune) and a success leaves exactly the live row."""
    _, token = user_a
    claims = verify_token(token)
    await push_svc.subscribe(
        claims, push_svc.PushSubscriptionCreate(**_sub_body("https://push.example.com/dead"))
    )
    await push_svc.subscribe(
        claims, push_svc.PushSubscriptionCreate(**_sub_body("https://push.example.com/live"))
    )

    def _selective(*args, **kwargs):
        endpoint = kwargs["subscription_info"]["endpoint"]
        if endpoint.endswith("/dead"):
            raise WebPushException("gone", response=_FakeResponse(410))
        return "ok"

    monkeypatch.setattr(push_svc, "webpush", _selective)

    result = await push_svc.deliver_to_user(
        claims, push_svc.NotificationPayload(title="t", body="b")
    )
    assert result.total == 2 and result.sent == 1 and result.pruned == 1

    async with rls_connection(claims) as conn:
        rows = await push_db.list_subscriptions(conn)
    assert len(rows) == 1 and rows[0]["endpoint"] == "https://push.example.com/live"


# --------------------------------------------------------------------------
# Dev-only test endpoint
# --------------------------------------------------------------------------
def test_test_endpoint_unavailable_outside_development(test_client, user_a, monkeypatch):
    _, token = user_a
    _storage.reset()
    monkeypatch.setattr(settings, "env", "production")
    r = test_client.post(f"{BASE}/test", headers=_auth(token))
    assert r.status_code == 404


def test_test_endpoint_available_in_development(test_client, user_a, monkeypatch):
    _, token = user_a
    _storage.reset()
    monkeypatch.setattr(settings, "env", "development")
    # No subscriptions registered → a clean zero-fan-out, no real push contacted.
    r = test_client.post(f"{BASE}/test", headers=_auth(token))
    assert r.status_code == 200
    assert r.json() == {"total": 0, "sent": 0, "pruned": 0, "failed": 0}


def test_test_endpoint_requires_auth(test_client):
    r = test_client.post(f"{BASE}/test")
    assert r.status_code == 401


@pytest.mark.parametrize("bad", ["", "not-base64!!", "a" * 600])
def test_subscribe_rejects_bad_keys(test_client, user_a, bad):
    _, token = user_a
    body = _sub_body()
    body["keys"]["p256dh"] = bad
    r = test_client.post(f"{BASE}/subscribe", headers=_auth(token), json=body)
    assert r.status_code == 422


# --------------------------------------------------------------------------
# Bounded reads on the key-carrying path.
#
# `list_subscriptions_for_response` was capped when the device-list route landed;
# this key-carrying sibling, which the user-initiated delivery fan-out uses, was
# left open-ended. Nothing in the schema bounds devices per account — each browser
# profile is another row — and each row here costs an encrypted request to a push
# service, so an unbounded read turns one send into unbounded outbound work.
# --------------------------------------------------------------------------
async def test_keyed_device_read_is_bounded(db_pool, user_a, monkeypatch):
    user_id, token = user_a
    claims = verify_token(token)
    for i in range(3):
        await push_svc.subscribe(
            claims,
            push_svc.PushSubscriptionCreate(
                **_sub_body(endpoint=f"https://push.example.com/cap-{i}")
            ),
        )

    monkeypatch.setattr(push_db, "_MAX_DEVICES_RETURNED", 2)
    async with rls_connection(claims) as conn:
        rows = await push_db.list_subscriptions(conn)
    assert len(rows) == 2, "the keyed device read ignored its ceiling"
    # Deterministic: a LIMIT without an ORDER BY makes which rows survive arbitrary.
    assert [r["endpoint"] for r in rows] == [
        "https://push.example.com/cap-0",
        "https://push.example.com/cap-1",
    ]
