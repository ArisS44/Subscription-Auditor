from datetime import date

import asyncpg


async def get_active_spend_by_group(conn: asyncpg.Connection) -> list[asyncpg.Record]:
    """Sum active spend grouped by (currency, category, billing_cycle) — Postgres
    does the grouping/summing so Python only handles a handful of buckets. Raw
    price is summed here; the monthly-equivalent factor is applied per bucket in
    the service (kept in one place). RLS scopes rows to the caller."""
    return await conn.fetch("""
        SELECT currency, category, billing_cycle, SUM(price) AS subtotal
        FROM subscriptions
        WHERE status = 'active'
        GROUP BY currency, category, billing_cycle
        """)


async def get_active_for_ranking(conn: asyncpg.Connection) -> list[asyncpg.Record]:
    """The minimal per-row data needed to rank top expenses by monthly-equivalent.
    Ranking happens in Python because the sort key is the normalization factor,
    which lives only in the service helper. RLS scopes rows to the caller."""
    return await conn.fetch("""
        SELECT id, name, price, currency, billing_cycle
        FROM subscriptions
        WHERE status = 'active'
        """)


async def get_upcoming_renewals(
    conn: asyncpg.Connection, *, start: date, end: date
) -> list[asyncpg.Record]:
    """Active subscriptions renewing within [start, end], ordered soonest-first.
    Pure SQL filter/sort — no normalization involved. RLS scopes to the caller."""
    return await conn.fetch(
        """
        SELECT id, name, price, currency, billing_cycle, next_renewal_date
        FROM subscriptions
        WHERE status = 'active'
          AND next_renewal_date IS NOT NULL
          AND next_renewal_date >= $1
          AND next_renewal_date <= $2
        ORDER BY next_renewal_date ASC, id ASC
        """,
        start,
        end,
    )
