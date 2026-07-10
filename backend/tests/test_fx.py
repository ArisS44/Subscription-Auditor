from datetime import UTC, datetime, timedelta
from decimal import Decimal

import httpx
import pytest

from app.db.pool import get_pool
from app.services import fx as svc

# A private ISO 4217 test currency code as base, so these tests never collide with
# real USD/EUR cache rows other features/tests may write.
_BASE = "XTS"
_NOW = datetime(2026, 7, 10, 12, 0, tzinfo=UTC)
_STALE = _NOW - timedelta(hours=13)  # older than the 12h TTL


def _client(handler) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


def _no_call(request: httpx.Request) -> httpx.Response:
    raise AssertionError("external FX source must not be called when cache is fresh")


def _rates(mapping: dict) -> object:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.host == "api.frankfurter.dev"  # fixed host, never user-supplied
        assert request.url.params.get("from") == _BASE
        return httpx.Response(200, json={"base": _BASE, "date": "2026-07-10", "rates": mapping})

    return handler


def _source_down(request: httpx.Request) -> httpx.Response:
    return httpx.Response(503, text="down")


async def _seed(quote: str, rate: str, fetched_at: datetime) -> None:
    async with get_pool().acquire() as conn:
        await conn.execute(
            """
            INSERT INTO fx_rates (base, quote, rate, fetched_at) VALUES ($1, $2, $3, $4)
            ON CONFLICT (base, quote)
            DO UPDATE SET rate = excluded.rate, fetched_at = excluded.fetched_at
            """,
            _BASE,
            quote,
            Decimal(rate),
            fetched_at,
        )


async def _clear() -> None:
    async with get_pool().acquire() as conn:
        await conn.execute("DELETE FROM fx_rates WHERE base = $1", _BASE)


async def test_fresh_cache_serves_without_external_call(db_pool):
    await _clear()
    await _seed("XAA", "0.5", _NOW)
    try:
        rate, as_of = await svc.get_rate(_BASE, "XAA", now=_NOW, client=_client(_no_call))
        assert rate == Decimal("0.5")
        assert as_of == _NOW
    finally:
        await _clear()


async def test_stale_cache_triggers_refresh(db_pool):
    await _clear()
    await _seed("XAA", "0.5", _STALE)
    try:
        rate, as_of = await svc.get_rate(
            _BASE, "XAA", now=_NOW, client=_client(_rates({"XAA": 0.7, "XBB": 0.9}))
        )
        assert rate == Decimal("0.7")  # refreshed value, not the stale 0.5
        assert as_of == _NOW
        # New sibling pair was upserted by the same refresh.
        rate_b, _ = await svc.get_rate(_BASE, "XBB", now=_NOW, client=_client(_no_call))
        assert rate_b == Decimal("0.9")
    finally:
        await _clear()


async def test_same_currency_is_identity(db_pool):
    rate, _ = await svc.get_rate(_BASE, _BASE, now=_NOW, client=_client(_no_call))
    assert rate == Decimal(1)


async def test_convert_math_is_correct(db_pool):
    await _clear()
    await _seed("XAA", "0.9", _NOW)
    try:
        result = await svc.convert(Decimal("100"), _BASE, "XAA", now=_NOW, client=_client(_no_call))
        assert result["rate"] == Decimal("0.9")
        assert result["converted"] == Decimal("90.00")
        assert result["base"] == _BASE and result["quote"] == "XAA"

        same = await svc.convert(Decimal("42.50"), _BASE, _BASE, now=_NOW, client=_client(_no_call))
        assert same["converted"] == Decimal("42.50")
    finally:
        await _clear()


async def test_source_failure_falls_back_to_last_good(db_pool):
    await _clear()
    await _seed("XAA", "0.5", _STALE)  # stale, so a refresh is attempted
    try:
        rate, as_of = await svc.get_rate(_BASE, "XAA", now=_NOW, client=_client(_source_down))
        # Source is down → serve the last-known-good stale rate rather than error.
        assert rate == Decimal("0.5")
        assert as_of == _STALE
    finally:
        await _clear()


async def test_cold_cache_with_source_down_raises(db_pool):
    await _clear()
    try:
        with pytest.raises(svc.FxUnavailableError):
            await svc.get_rate(_BASE, "XAA", now=_NOW, client=_client(_source_down))
    finally:
        await _clear()


async def test_get_rates_filters_to_requested_symbols(db_pool):
    await _clear()
    await _seed("XAA", "0.5", _NOW)
    await _seed("XBB", "0.9", _NOW)
    try:
        result = await svc.get_rates(_BASE, ["XAA"], now=_NOW, client=_client(_no_call))
        assert result["base"] == _BASE
        assert result["rates"] == {"XAA": Decimal("0.5")}
        assert result["as_of"] == _NOW
    finally:
        await _clear()


# --------------------------------------------------------------------------
# HTTP layer: auth + validation + error mapping (hermetic — service stubbed).
# --------------------------------------------------------------------------
def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def test_convert_endpoint_requires_auth(test_client):
    r = test_client.get("/api/v1/fx/convert", params={"from": "USD", "to": "EUR", "amount": 10})
    assert r.status_code == 401


def test_convert_endpoint_rejects_bad_currency(test_client, user_a):
    _, token = user_a
    r = test_client.get(
        "/api/v1/fx/convert",
        headers=_auth(token),
        params={"from": "usd", "to": "EUR", "amount": 10},  # lowercase fails the pattern
    )
    assert r.status_code == 422


def test_convert_endpoint_returns_conversion(test_client, user_a, monkeypatch):
    _, token = user_a

    async def _fake_convert(amount, base, quote, **kwargs):
        return {
            "amount": amount,
            "base": base,
            "quote": quote,
            "rate": Decimal("0.9"),
            "converted": Decimal("90.00"),
            "as_of": _NOW,
        }

    monkeypatch.setattr(svc, "convert", _fake_convert)
    r = test_client.get(
        "/api/v1/fx/convert",
        headers=_auth(token),
        params={"from": "USD", "to": "EUR", "amount": 100},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["converted"] == "90.00"
    assert body["base"] == "USD" and body["quote"] == "EUR"


def test_convert_endpoint_maps_unavailable_to_503(test_client, user_a, monkeypatch):
    _, token = user_a

    async def _boom(*args, **kwargs):
        raise svc.FxUnavailableError("cold")

    monkeypatch.setattr(svc, "convert", _boom)
    r = test_client.get(
        "/api/v1/fx/convert",
        headers=_auth(token),
        params={"from": "USD", "to": "EUR", "amount": 100},
    )
    assert r.status_code == 503
