from datetime import datetime
from decimal import Decimal

import asyncpg

# All reads/writes here run on a plain pooled connection (not rls_connection), so
# they execute as the service role and bypass RLS — fx_rates is global reference
# data whose only write path is the backend cache refresh.


async def get_rate(conn: asyncpg.Connection, base: str, quote: str) -> asyncpg.Record | None:
    """The cached rate row for one directed pair, or None if never fetched."""
    return await conn.fetchrow(
        "SELECT rate, fetched_at FROM fx_rates WHERE base = $1 AND quote = $2", base, quote
    )


async def max_fetched_at(conn: asyncpg.Connection, base: str) -> datetime | None:
    """The freshest fetch time across all quotes of a base — used to decide whether
    the base's cache as a whole is stale."""
    return await conn.fetchval("SELECT max(fetched_at) FROM fx_rates WHERE base = $1", base)


async def get_rates_for_base(
    conn: asyncpg.Connection, base: str, symbols: list[str] | None = None
) -> dict[str, Decimal]:
    """Cached quote->rate map for a base, optionally restricted to `symbols`."""
    if symbols:
        rows = await conn.fetch(
            "SELECT quote, rate FROM fx_rates WHERE base = $1 AND quote = ANY($2::text[])",
            base,
            symbols,
        )
    else:
        rows = await conn.fetch("SELECT quote, rate FROM fx_rates WHERE base = $1", base)
    return {r["quote"]: r["rate"] for r in rows}


async def upsert_rates(
    conn: asyncpg.Connection, base: str, rates: dict[str, Decimal], fetched_at: datetime
) -> None:
    """Upsert the latest rates for a base on the (base, quote) unique key — one
    current row per directed pair."""
    await conn.executemany(
        """
        INSERT INTO fx_rates (base, quote, rate, fetched_at)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (base, quote)
        DO UPDATE SET rate = excluded.rate, fetched_at = excluded.fetched_at
        """,
        [(base, quote, rate, fetched_at) for quote, rate in rates.items()],
    )
