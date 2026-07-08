from datetime import date, timedelta
from decimal import Decimal

from app.services.analytics import monthly_equivalent

BASE = "/api/v1/subscriptions"
ANALYTICS = f"{BASE}/analytics"


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _payload(**overrides) -> dict:
    body = {
        "name": "Sub",
        "category": "other",
        "price": "10.00",
        "currency": "USD",
        "billing_cycle": "monthly",
        "start_date": "2026-01-01",
    }
    body.update(overrides)
    return body


# --------------------------------------------------------------------------
# Pure helper: cycle normalization math (no DB/HTTP)
# --------------------------------------------------------------------------
def test_monthly_equivalent_all_cycles():
    assert monthly_equivalent(Decimal("12"), "weekly") == Decimal("12") * 52 / 12
    assert monthly_equivalent(Decimal("12"), "weekly") == Decimal("52")
    assert monthly_equivalent(Decimal("10"), "monthly") == Decimal("10")
    assert monthly_equivalent(Decimal("30"), "quarterly") == Decimal("10")
    assert monthly_equivalent(Decimal("120"), "yearly") == Decimal("10")


# --------------------------------------------------------------------------
# Endpoint behavior
# --------------------------------------------------------------------------
def test_empty_portfolio_returns_wellformed_zeros(test_client, user_a):
    _, token = user_a
    r = test_client.get(ANALYTICS, headers=_auth(token))
    assert r.status_code == 200
    body = r.json()
    assert body["monthly_burn_by_currency"] == {}
    assert body["annual_projection_by_currency"] == {}
    assert body["top_expenses"] == []
    assert body["upcoming_renewals"] == []
    assert body["spend_by_category"] == []


def test_monthly_burn_and_annual_per_currency(test_client, user_a):
    _, token = user_a
    # USD: $10/mo (10) + $120/yr (10) = 20/mo ; EUR: €12/wk (52) = 52/mo
    test_client.post(
        BASE, headers=_auth(token), json=_payload(price="10.00", billing_cycle="monthly")
    )
    test_client.post(
        BASE, headers=_auth(token), json=_payload(price="120.00", billing_cycle="yearly")
    )
    test_client.post(
        BASE,
        headers=_auth(token),
        json=_payload(price="12.00", currency="EUR", billing_cycle="weekly"),
    )

    body = test_client.get(ANALYTICS, headers=_auth(token)).json()
    burn = body["monthly_burn_by_currency"]
    annual = body["annual_projection_by_currency"]
    assert float(burn["USD"]) == 20.00
    assert float(burn["EUR"]) == 52.00
    # Per-currency, never mixed into a single total.
    assert set(burn.keys()) == {"USD", "EUR"}
    assert float(annual["USD"]) == 240.00  # 20 * 12
    assert float(annual["EUR"]) == 624.00  # 52 * 12


def test_active_only_excludes_cancelled_and_paused(test_client, user_a):
    _, token = user_a
    test_client.post(BASE, headers=_auth(token), json=_payload(name="Active", price="10.00"))
    paused = test_client.post(
        BASE, headers=_auth(token), json=_payload(name="Paused", price="99.00", status="paused")
    ).json()
    cancel_me = test_client.post(
        BASE, headers=_auth(token), json=_payload(name="Cancelled", price="88.00")
    ).json()
    test_client.post(f"{BASE}/{cancel_me['id']}/cancel", headers=_auth(token))

    body = test_client.get(ANALYTICS, headers=_auth(token)).json()
    # Only the active $10 counts.
    assert float(body["monthly_burn_by_currency"]["USD"]) == 10.00
    names = {e["name"] for e in body["top_expenses"]}
    assert names == {"Active"}
    assert paused["status"] == "paused"  # sanity: it exists, just excluded


def test_no_cross_currency_mixing_in_categories(test_client, user_a):
    _, token = user_a
    test_client.post(
        BASE,
        headers=_auth(token),
        json=_payload(price="10.00", currency="USD", category="streaming"),
    )
    test_client.post(
        BASE,
        headers=_auth(token),
        json=_payload(price="20.00", currency="EUR", category="streaming"),
    )
    body = test_client.get(ANALYTICS, headers=_auth(token)).json()
    cats = {
        (c["currency"], c["category"]): float(c["monthly_equivalent"])
        for c in body["spend_by_category"]
    }
    # Same category, two currencies, kept separate.
    assert cats[("USD", "streaming")] == 10.00
    assert cats[("EUR", "streaming")] == 20.00


def test_null_category_grouped_as_other(test_client, user_a):
    _, token = user_a
    # category omitted -> null in DB -> grouped as "other"
    payload = _payload(price="15.00")
    del payload["category"]
    test_client.post(BASE, headers=_auth(token), json=payload)
    body = test_client.get(ANALYTICS, headers=_auth(token)).json()
    cats = {c["category"] for c in body["spend_by_category"]}
    assert "other" in cats


def test_top_expenses_sorted_desc_and_capped(test_client, user_a):
    _, token = user_a
    # 6 active subs with distinct monthly-equivalents; expect top 5 desc.
    for i, price in enumerate(["5.00", "60.00", "10.00", "30.00", "20.00", "50.00"]):
        test_client.post(BASE, headers=_auth(token), json=_payload(name=f"S{i}", price=price))
    body = test_client.get(ANALYTICS, headers=_auth(token)).json()
    top = body["top_expenses"]
    amounts = [float(e["monthly_equivalent"]) for e in top]
    assert len(top) == 5  # capped
    assert amounts == sorted(amounts, reverse=True)  # descending
    assert amounts[0] == 60.00
    assert 5.00 not in amounts  # the smallest fell off the top 5


def test_top_expenses_ranked_per_currency_not_across(test_client, user_a):
    _, token = user_a
    # A JPY subscription that is numerically far larger than any EUR one. Under the
    # old global ranking it would dominate the flat top-5 and could crowd genuine
    # EUR top items out entirely. Per-currency, each currency keeps its own top list.
    test_client.post(
        BASE, headers=_auth(token), json=_payload(name="JPY-big", currency="JPY", price="3000.00")
    )
    test_client.post(
        BASE, headers=_auth(token), json=_payload(name="EUR-top", currency="EUR", price="50.00")
    )
    test_client.post(
        BASE, headers=_auth(token), json=_payload(name="EUR-low", currency="EUR", price="8.00")
    )

    body = test_client.get(ANALYTICS, headers=_auth(token)).json()
    top = body["top_expenses"]
    by_currency: dict[str, list] = {}
    for e in top:
        by_currency.setdefault(e["currency"], []).append(e)

    # Both currencies are represented — the large JPY item did not evict the EUR ones.
    assert set(by_currency) == {"EUR", "JPY"}
    assert [e["name"] for e in by_currency["JPY"]] == ["JPY-big"]
    # EUR ranked within its own currency, amount desc.
    eur_names = [e["name"] for e in by_currency["EUR"]]
    assert eur_names == ["EUR-top", "EUR-low"]


def test_top_expenses_capped_per_currency(test_client, user_a):
    _, token = user_a
    # 6 EUR + 6 JPY active subs: expect top 5 within *each* currency (10 total),
    # not a flat top-5 across the whole portfolio.
    for i, price in enumerate(["5.00", "60.00", "10.00", "30.00", "20.00", "50.00"]):
        test_client.post(
            BASE, headers=_auth(token), json=_payload(name=f"E{i}", currency="EUR", price=price)
        )
    for i, price in enumerate(["7.00", "70.00", "17.00", "37.00", "27.00", "57.00"]):
        test_client.post(
            BASE, headers=_auth(token), json=_payload(name=f"J{i}", currency="JPY", price=price)
        )

    body = test_client.get(ANALYTICS, headers=_auth(token)).json()
    top = body["top_expenses"]
    eur = [float(e["monthly_equivalent"]) for e in top if e["currency"] == "EUR"]
    jpy = [float(e["monthly_equivalent"]) for e in top if e["currency"] == "JPY"]
    assert len(eur) == 5 and len(jpy) == 5  # capped per currency, 10 total
    assert eur == sorted(eur, reverse=True) and jpy == sorted(jpy, reverse=True)
    assert 5.00 not in eur and 7.00 not in jpy  # smallest in each currency fell off


def test_upcoming_renewals_within_30_days_only(test_client, user_a):
    _, token = user_a
    today = date.today()
    inside = (today + timedelta(days=10)).isoformat()
    edge = (today + timedelta(days=30)).isoformat()
    outside = (today + timedelta(days=45)).isoformat()

    test_client.post(
        BASE, headers=_auth(token), json=_payload(name="Soon", next_renewal_date=inside)
    )
    test_client.post(BASE, headers=_auth(token), json=_payload(name="Edge", next_renewal_date=edge))
    test_client.post(
        BASE, headers=_auth(token), json=_payload(name="Later", next_renewal_date=outside)
    )
    # A cancelled one inside the window must still be excluded (active-only).
    cancelled = test_client.post(
        BASE, headers=_auth(token), json=_payload(name="Gone", next_renewal_date=inside)
    ).json()
    test_client.post(f"{BASE}/{cancelled['id']}/cancel", headers=_auth(token))

    body = test_client.get(ANALYTICS, headers=_auth(token)).json()
    names = [r["name"] for r in body["upcoming_renewals"]]
    assert "Soon" in names and "Edge" in names  # within window (inclusive edge)
    assert "Later" not in names and "Gone" not in names
    # Sorted soonest-first.
    dates = [r["next_renewal_date"] for r in body["upcoming_renewals"]]
    assert dates == sorted(dates)
