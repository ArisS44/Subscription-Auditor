from datetime import date, timedelta
from decimal import Decimal

from app.db import subscriptions as subs_db
from app.db.rls import rls_connection
from app.deps import verify_token
from app.middleware.rate_limit import _storage

BASE = "/api/v1/subscriptions"


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _payload(**overrides) -> dict:
    """A valid create payload; override any field per test."""
    body = {
        "name": "Claude Pro",
        "category": "ai_tool",
        "price": "20.00",
        "currency": "USD",
        "billing_cycle": "monthly",
        "start_date": "2026-01-01",
    }
    body.update(overrides)
    return body


# --------------------------------------------------------------------------
# Create / read happy paths
# --------------------------------------------------------------------------
def test_create_returns_201_with_owner_from_jwt(test_client, user_a):
    user_id, token = user_a
    r = test_client.post(BASE, headers=_auth(token), json=_payload())
    assert r.status_code == 201
    body = r.json()
    assert body["user_id"] == user_id  # owner is the caller, from the JWT
    assert body["name"] == "Claude Pro"
    assert float(body["price"]) == 20.0
    assert body["status"] == "active"
    assert body["next_renewal_date"] is not None  # computed on create


def test_create_and_get_by_id(test_client, user_a):
    _, token = user_a
    created = test_client.post(BASE, headers=_auth(token), json=_payload()).json()
    r = test_client.get(f"{BASE}/{created['id']}", headers=_auth(token))
    assert r.status_code == 200
    assert r.json()["id"] == created["id"]


def test_create_computes_next_renewal_strictly_after_today(test_client, user_a):
    _, token = user_a
    body = test_client.post(
        BASE, headers=_auth(token), json=_payload(next_renewal_date=None)
    ).json()
    assert date.fromisoformat(body["next_renewal_date"]) > date.today()


def test_create_respects_client_supplied_renewal_date(test_client, user_a):
    _, token = user_a
    explicit = "2030-05-05"
    body = test_client.post(
        BASE, headers=_auth(token), json=_payload(next_renewal_date=explicit)
    ).json()
    assert body["next_renewal_date"] == explicit  # user intent wins, stored as-is


def test_create_ignores_user_id_in_body(test_client, user_a, user_b):
    """A client-supplied user_id must never set ownership — it is dropped, and the
    row is owned by the JWT caller. This is the hard security requirement."""
    caller_id, token = user_a
    other_id, _ = user_b
    body = test_client.post(BASE, headers=_auth(token), json=_payload(user_id=other_id)).json()
    assert body["user_id"] == caller_id
    assert body["user_id"] != other_id


# --------------------------------------------------------------------------
# List: pagination / filter / sort
# --------------------------------------------------------------------------
def test_list_pagination_reports_total(test_client, user_a):
    _, token = user_a
    for i in range(3):
        test_client.post(BASE, headers=_auth(token), json=_payload(name=f"S{i}"))
    r = test_client.get(BASE, headers=_auth(token), params={"limit": 2, "offset": 0})
    assert r.status_code == 200
    body = r.json()
    assert len(body["items"]) == 2  # page size
    assert body["total"] == 3  # full count before pagination


def test_list_filter_by_status_excludes_cancelled(test_client, user_a):
    _, token = user_a
    test_client.post(BASE, headers=_auth(token), json=_payload(name="Keep"))
    gone = test_client.post(BASE, headers=_auth(token), json=_payload(name="Gone")).json()
    test_client.post(f"{BASE}/{gone['id']}/cancel", headers=_auth(token))

    r = test_client.get(BASE, headers=_auth(token), params={"status": "active"})
    names = [s["name"] for s in r.json()["items"]]
    assert "Keep" in names and "Gone" not in names


def test_list_filter_by_category(test_client, user_a):
    _, token = user_a
    test_client.post(BASE, headers=_auth(token), json=_payload(name="AI", category="ai_tool"))
    test_client.post(BASE, headers=_auth(token), json=_payload(name="TV", category="streaming"))
    r = test_client.get(BASE, headers=_auth(token), params={"category": "streaming"})
    items = r.json()["items"]
    assert [s["name"] for s in items] == ["TV"]


def test_list_sort_by_price_desc(test_client, user_a):
    _, token = user_a
    for p in ("10.00", "30.00", "20.00"):
        test_client.post(BASE, headers=_auth(token), json=_payload(name=f"P{p}", price=p))
    r = test_client.get(BASE, headers=_auth(token), params={"sort_by": "price", "order": "desc"})
    prices = [float(s["price"]) for s in r.json()["items"]]
    assert prices == sorted(prices, reverse=True)
    assert prices[0] == 30.0


# --------------------------------------------------------------------------
# Update / cancel / delete
# --------------------------------------------------------------------------
def test_update_changes_fields(test_client, user_a):
    _, token = user_a
    sub = test_client.post(BASE, headers=_auth(token), json=_payload()).json()
    r = test_client.patch(
        f"{BASE}/{sub['id']}", headers=_auth(token), json={"name": "Renamed", "price": "5.50"}
    )
    assert r.status_code == 200
    body = r.json()
    assert body["name"] == "Renamed"
    assert float(body["price"]) == 5.5


def test_update_recomputes_renewal_on_cycle_change(test_client, user_a):
    _, token = user_a
    sub = test_client.post(
        BASE, headers=_auth(token), json=_payload(billing_cycle="monthly", next_renewal_date=None)
    ).json()
    before = sub["next_renewal_date"]
    updated = test_client.patch(
        f"{BASE}/{sub['id']}", headers=_auth(token), json={"billing_cycle": "yearly"}
    ).json()
    # Renewal recomputed (client did not supply one in this patch), still valid.
    assert updated["next_renewal_date"] != before
    assert date.fromisoformat(updated["next_renewal_date"]) > date.today()


def test_update_keeps_client_renewal_date_when_supplied(test_client, user_a):
    _, token = user_a
    sub = test_client.post(BASE, headers=_auth(token), json=_payload()).json()
    updated = test_client.patch(
        f"{BASE}/{sub['id']}",
        headers=_auth(token),
        json={"billing_cycle": "yearly", "next_renewal_date": "2031-01-01"},
    ).json()
    assert updated["next_renewal_date"] == "2031-01-01"


def test_cancel_soft_deletes(test_client, user_a):
    _, token = user_a
    sub = test_client.post(BASE, headers=_auth(token), json=_payload()).json()
    r = test_client.post(f"{BASE}/{sub['id']}/cancel", headers=_auth(token))
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "cancelled"
    assert body["cancellation_date"] == date.today().isoformat()
    # Row is retained, still readable.
    assert test_client.get(f"{BASE}/{sub['id']}", headers=_auth(token)).status_code == 200


def test_cancel_accepts_explicit_date(test_client, user_a):
    _, token = user_a
    sub = test_client.post(BASE, headers=_auth(token), json=_payload()).json()
    body = test_client.post(
        f"{BASE}/{sub['id']}/cancel", headers=_auth(token), json={"cancellation_date": "2026-06-30"}
    ).json()
    assert body["cancellation_date"] == "2026-06-30"


def test_delete_removes_row(test_client, user_a):
    _, token = user_a
    sub = test_client.post(BASE, headers=_auth(token), json=_payload()).json()
    r = test_client.delete(f"{BASE}/{sub['id']}", headers=_auth(token))
    assert r.status_code == 204
    assert test_client.get(f"{BASE}/{sub['id']}", headers=_auth(token)).status_code == 404


# --------------------------------------------------------------------------
# Validation (422) and not-found (404)
# --------------------------------------------------------------------------
def test_validation_rejections_return_422(test_client, user_a):
    _, token = user_a
    bad_cases = {
        "bad category": _payload(category="gaming"),
        "billing_cycle custom (out of scope)": _payload(billing_cycle="custom"),
        "bad status": _payload(status="archived"),
        "negative price": _payload(price="-1.00"),
        "over-length name": _payload(name="z" * 201),
        "over-length notes": _payload(notes="z" * 2001),
        "malformed date": _payload(start_date="not-a-date"),
        "bad currency": _payload(currency="usd"),
    }
    for label, body in bad_cases.items():
        r = test_client.post(BASE, headers=_auth(token), json=body)
        assert r.status_code == 422, f"{label} should be 422, got {r.status_code}"


def test_manage_url_round_trips_through_create_update_get(test_client, user_a):
    _, token = user_a
    created = test_client.post(
        BASE, headers=_auth(token), json=_payload(manage_url="https://example.com/account/billing")
    ).json()
    assert created["manage_url"] == "https://example.com/account/billing"  # stored as-is on create

    got = test_client.get(f"{BASE}/{created['id']}", headers=_auth(token)).json()
    assert got["manage_url"] == "https://example.com/account/billing"  # round-trips on get

    updated = test_client.patch(
        f"{BASE}/{created['id']}",
        headers=_auth(token),
        json={"manage_url": "http://provider.example/cancel"},
    ).json()
    assert updated["manage_url"] == "http://provider.example/cancel"  # updatable


def test_manage_url_rejects_non_http_and_oversized(test_client, user_a):
    _, token = user_a
    bad_cases = {
        "javascript scheme": _payload(manage_url="javascript:alert(1)"),
        "ftp scheme": _payload(manage_url="ftp://example.com/file"),
        "not a url": _payload(manage_url="not-a-url"),
        "oversized": _payload(manage_url="https://example.com/" + "a" * 2100),
    }
    for label, body in bad_cases.items():
        r = test_client.post(BASE, headers=_auth(token), json=body)
        assert r.status_code == 422, f"{label} should be 422, got {r.status_code}"


def test_get_nonexistent_returns_404(test_client, user_a):
    _, token = user_a
    missing = "00000000-0000-0000-0000-000000000000"
    assert test_client.get(f"{BASE}/{missing}", headers=_auth(token)).status_code == 404


def test_cross_user_http_get_returns_404_not_403(test_client, user_a, user_b):
    """Another user's subscription must look non-existent (404), never forbidden
    (403) — 403 would confirm the id exists and leak information."""
    _, token_a = user_a
    _, token_b = user_b
    sub = test_client.post(BASE, headers=_auth(token_a), json=_payload()).json()
    r = test_client.get(f"{BASE}/{sub['id']}", headers=_auth(token_b))
    assert r.status_code == 404


# --------------------------------------------------------------------------
# PATCH /me
# --------------------------------------------------------------------------
def test_patch_me_updates_display_name_and_language(test_client, user_a):
    _, token = user_a
    # /api/v1/me is the one rate-limited path and its counter is shared across
    # the suite — reset so this test starts with a clean window.
    _storage.reset()

    r = test_client.patch(
        "/api/v1/me",
        headers=_auth(token),
        json={"display_name": "Aris", "preferred_language": "el"},
    )
    assert r.status_code == 200
    assert r.json()["display_name"] == "Aris"
    assert r.json()["preferred_language"] == "el"

    # Persisted: a fresh GET reflects the change.
    me = test_client.get("/api/v1/me", headers=_auth(token)).json()
    assert me["display_name"] == "Aris"
    assert me["preferred_language"] == "el"


def test_patch_me_rejects_bad_language(test_client, user_a):
    _, token = user_a
    _storage.reset()
    r = test_client.patch("/api/v1/me", headers=_auth(token), json={"preferred_language": "fr"})
    assert r.status_code == 422


# --------------------------------------------------------------------------
# Real-DB cross-user RLS denial (second security wall) — mirrors test_rls.py
# --------------------------------------------------------------------------
async def test_cross_user_subscription_denied_by_rls(db_pool, user_a, user_b):
    """Authenticated as user A, a query for user B's subscription must return
    None — not because app code filtered it, but because Postgres RLS excludes
    rows failing `auth.uid() = user_id`. If set_config weren't transaction-scoped
    or the claims shape were wrong, this would leak user B's row. This is the
    second wall, verified against the real database, not mocked.
    """
    _, token_a = user_a
    b_id, token_b = user_b
    claims_a = verify_token(token_a)
    claims_b = verify_token(token_b)

    # User B creates a subscription through their own RLS-scoped connection.
    async with rls_connection(claims_b) as conn:
        row = await subs_db.insert_subscription(
            conn,
            user_id=b_id,
            name="B private",
            category=None,
            price=Decimal("9.99"),
            currency="USD",
            billing_cycle="monthly",
            start_date=date(2026, 1, 1),
            next_renewal_date=date.today() + timedelta(days=30),
            status="active",
            notes=None,
            manage_url=None,
        )
    sub_id = str(row["id"])

    # Owner can read it.
    async with rls_connection(claims_b) as conn:
        assert await subs_db.get_subscription_by_id(conn, sub_id) is not None

    # Non-owner cannot — RLS returns no row.
    async with rls_connection(claims_a) as conn:
        assert await subs_db.get_subscription_by_id(conn, sub_id) is None
