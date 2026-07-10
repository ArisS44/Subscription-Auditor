"""Currency conversion via a lazily-refreshed, cached FX-rate layer.

No scheduler and no background jobs (deliberately out of scope this session):
rates are cached in `fx_rates` with a staleness TTL and refreshed inline on the
first request that finds the cache stale or missing. On an external-source
failure the last-known-good cached rates are served rather than erroring; only a
cold cache with a down source is a hard error. Per-currency grouping stays the
default everywhere — this path serves the opt-in conversion the Overview offers,
always labeled an estimate at the UI layer.
"""

import logging
from datetime import UTC, datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal

import httpx

from app.db import fx as fx_db
from app.db.pool import get_pool

logger = logging.getLogger("app.services.fx")

# A cached rate older than this is refreshed on next use. 12h matches daily ECB
# updates without hammering the source.
FX_TTL = timedelta(hours=12)

# Fixed provider host (ECB data, no API key). This is NOT a user-supplied URL, so
# there's no SSRF surface — never generalize this into fetching arbitrary hosts.
# frankfurter.dev/v1 is the current canonical host (the older frankfurter.app
# 301-redirects here).
_FRANKFURTER_BASE = "https://api.frankfurter.dev/v1"

_client: httpx.AsyncClient | None = None


class FxUnavailableError(RuntimeError):
    """No usable rate: the cache is cold for the pair and the source is down."""


def _get_client() -> httpx.AsyncClient:
    """Lazily create a shared async client, mirroring the pattern in llm.py. Tests
    inject their own client so this is only used in real runs."""
    global _client
    if _client is None:
        _client = httpx.AsyncClient(timeout=httpx.Timeout(10.0, connect=5.0), follow_redirects=True)
    return _client


async def close_client() -> None:
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None


def _now() -> datetime:
    return datetime.now(UTC)


def _is_stale(fetched_at: datetime, now: datetime) -> bool:
    return fetched_at < now - FX_TTL


def _money(amount: Decimal) -> Decimal:
    return amount.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


async def _fetch_rates(base: str, client: httpx.AsyncClient) -> dict[str, Decimal]:
    """Fetch all current rates for `base` from the external source in one call.
    Raises httpx.HTTPError on any transport/HTTP failure (caller handles fallback).
    Values go through Decimal(str(...)) to avoid binary-float drift."""
    resp = await client.get(f"{_FRANKFURTER_BASE}/latest", params={"from": base})
    resp.raise_for_status()
    data = resp.json()
    return {quote: Decimal(str(value)) for quote, value in data.get("rates", {}).items()}


async def _try_refresh(base: str, conn, now: datetime, client: httpx.AsyncClient) -> bool:
    """Refresh the whole base's rates from the source and upsert them. Returns
    False (rather than raising) on source failure, so callers can fall back to
    cached data."""
    try:
        rates = await _fetch_rates(base, client)
    except httpx.HTTPError as exc:
        logger.warning("fx refresh failed base=%s error=%s", base, type(exc).__name__)
        return False
    if not rates:
        return False
    await fx_db.upsert_rates(conn, base, rates, now)
    return True


async def get_rate(
    base: str,
    quote: str,
    *,
    now: datetime | None = None,
    client: httpx.AsyncClient | None = None,
) -> tuple[Decimal, datetime]:
    """Return (rate, as_of) for base->quote. Serves a fresh cached rate without any
    external call; refreshes on stale/missing; on source failure falls back to the
    last-known-good cached rate; errors only when nothing is cached and the source
    is down."""
    now = now or _now()
    if base == quote:
        return Decimal(1), now
    client = client or _get_client()
    pool = get_pool()
    async with pool.acquire() as conn:
        cached = await fx_db.get_rate(conn, base, quote)
        if cached is not None and not _is_stale(cached["fetched_at"], now):
            return cached["rate"], cached["fetched_at"]

        refreshed = await _try_refresh(base, conn, now, client)
        if refreshed:
            fresh = await fx_db.get_rate(conn, base, quote)
            if fresh is not None:
                return fresh["rate"], fresh["fetched_at"]

        # Refresh failed, or succeeded but the source doesn't quote this pair:
        # serve the last-known-good rate if we have one.
        if cached is not None:
            return cached["rate"], cached["fetched_at"]
        raise FxUnavailableError(f"No rate available for {base}->{quote}")


async def get_rates(
    base: str,
    symbols: list[str] | None = None,
    *,
    now: datetime | None = None,
    client: httpx.AsyncClient | None = None,
) -> dict:
    """Return {base, rates, as_of} for the Overview, refreshing the base's cache
    lazily if stale/missing and falling back to whatever is cached on failure."""
    now = now or _now()
    client = client or _get_client()
    pool = get_pool()
    async with pool.acquire() as conn:
        latest = await fx_db.max_fetched_at(conn, base)
        if latest is None or _is_stale(latest, now):
            refreshed = await _try_refresh(base, conn, now, client)
            if refreshed:
                latest = await fx_db.max_fetched_at(conn, base)
            elif latest is None:
                raise FxUnavailableError(f"No rates available for base {base}")
        rates = await fx_db.get_rates_for_base(conn, base, symbols)
    return {"base": base, "rates": rates, "as_of": latest}


async def convert(
    amount: Decimal,
    base: str,
    quote: str,
    *,
    now: datetime | None = None,
    client: httpx.AsyncClient | None = None,
) -> dict:
    """Convert `amount` from `base` to `quote`, rounding the result to 2 dp."""
    rate, as_of = await get_rate(base, quote, now=now, client=client)
    return {
        "amount": amount,
        "base": base,
        "quote": quote,
        "rate": rate,
        "converted": _money(amount * rate),
        "as_of": as_of,
    }
