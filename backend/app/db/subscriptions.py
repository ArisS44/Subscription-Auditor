from datetime import date

import asyncpg

# The full response column set, selected/returned by every read and write below.
# Kept as one constant so the SELECT/RETURNING lists never drift from each other.
_COLUMNS = (
    "id, user_id, name, category, price, currency, billing_cycle, start_date, "
    "next_renewal_date, status, cancellation_date, notes, created_at, updated_at"
)

# ORDER BY targets an identifier + keyword, which cannot be a bind parameter — so
# the caller-supplied sort is validated against these allowlists and only the
# mapped literal token is ever interpolated. Any value outside the maps raises
# KeyError rather than reaching the SQL string. The router already constrains
# these via Literal types; this is the second wall.
_SORT_COLUMNS = {
    "name": "name",
    "price": "price",
    "next_renewal_date": "next_renewal_date",
    "created_at": "created_at",
}
_SORT_ORDERS = {"asc": "ASC", "desc": "DESC"}

# Columns a partial update may touch. user_id / id / created_at are deliberately
# excluded — ownership and identity are not client-mutable.
_UPDATABLE_COLUMNS = frozenset(
    {
        "name",
        "category",
        "price",
        "currency",
        "billing_cycle",
        "start_date",
        "next_renewal_date",
        "status",
        "cancellation_date",
        "notes",
    }
)


async def list_subscriptions(
    conn: asyncpg.Connection,
    *,
    status: str | None,
    category: str | None,
    sort_by: str,
    order: str,
    limit: int,
    offset: int,
) -> list[asyncpg.Record]:
    """Return one page of the caller's subscriptions. Row visibility is scoped by
    RLS on the connection (see `app.db.rls.rls_connection`) — this function adds
    only the optional status/category filters, the validated sort, and pagination.
    A secondary `id` sort key makes pagination deterministic when the primary sort
    column has ties.
    """
    sort_col = _SORT_COLUMNS[sort_by]
    sort_dir = _SORT_ORDERS[order]
    query = f"""
        SELECT {_COLUMNS} FROM subscriptions
        WHERE ($1::text IS NULL OR status = $1)
          AND ($2::text IS NULL OR category = $2)
        ORDER BY {sort_col} {sort_dir}, id ASC
        LIMIT $3 OFFSET $4
    """
    return await conn.fetch(query, status, category, limit, offset)


async def count_subscriptions(
    conn: asyncpg.Connection,
    *,
    status: str | None,
    category: str | None,
) -> int:
    """Total rows matching the same filter as `list_subscriptions`, before
    pagination — so the client can compute page counts."""
    return await conn.fetchval(
        """
        SELECT count(*) FROM subscriptions
        WHERE ($1::text IS NULL OR status = $1)
          AND ($2::text IS NULL OR category = $2)
        """,
        status,
        category,
    )


async def get_subscription_by_id(conn: asyncpg.Connection, sub_id: str) -> asyncpg.Record | None:
    """Fetch one subscription by id, scoped by RLS. A non-owner's id returns None
    (Postgres filters it before this function sees it) — the router turns that into
    a 404, never a 403, so existence isn't leaked."""
    return await conn.fetchrow(f"SELECT {_COLUMNS} FROM subscriptions WHERE id = $1", sub_id)


async def insert_subscription(
    conn: asyncpg.Connection,
    *,
    user_id: str,
    name: str,
    category: str | None,
    price: object,
    currency: str,
    billing_cycle: str,
    start_date: date,
    next_renewal_date: date | None,
    status: str,
    notes: str | None,
) -> asyncpg.Record:
    """Insert a new subscription and return the created row. `user_id` is passed
    explicitly by the service from the JWT `sub` claim — never from the request
    body — and the RLS INSERT WITH CHECK policy independently verifies it equals
    auth.uid()."""
    return await conn.fetchrow(
        f"""
        INSERT INTO subscriptions
          (user_id, name, category, price, currency, billing_cycle,
           start_date, next_renewal_date, status, notes)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING {_COLUMNS}
        """,
        user_id,
        name,
        category,
        price,
        currency,
        billing_cycle,
        start_date,
        next_renewal_date,
        status,
        notes,
    )


async def update_subscription(
    conn: asyncpg.Connection, sub_id: str, fields: dict
) -> asyncpg.Record | None:
    """Apply a partial update. Column names come only from the `_UPDATABLE_COLUMNS`
    allowlist (never from raw client keys); values are bound parameters. Returns
    the updated row, or None if RLS/id matched nothing (→ 404). With no updatable
    fields, returns the current row unchanged."""
    items = [(col, val) for col, val in fields.items() if col in _UPDATABLE_COLUMNS]
    if not items:
        return await get_subscription_by_id(conn, sub_id)

    set_clauses = []
    values: list = []
    for idx, (col, val) in enumerate(items, start=1):
        set_clauses.append(f"{col} = ${idx}")
        values.append(val)
    set_sql = ", ".join(set_clauses) + ", updated_at = now()"
    id_param = len(values) + 1
    values.append(sub_id)

    return await conn.fetchrow(
        f"UPDATE subscriptions SET {set_sql} WHERE id = ${id_param} RETURNING {_COLUMNS}",
        *values,
    )


async def delete_subscription(conn: asyncpg.Connection, sub_id: str) -> asyncpg.Record | None:
    """Hard-delete a subscription. RETURNING lets the service distinguish a real
    delete (row returned) from nothing matched under RLS (None → 404)."""
    return await conn.fetchrow("DELETE FROM subscriptions WHERE id = $1 RETURNING id", sub_id)


async def cancel_subscription(
    conn: asyncpg.Connection, sub_id: str, cancellation_date: date
) -> asyncpg.Record | None:
    """Soft-cancel: flip status to 'cancelled' and stamp the cancellation date,
    retaining the row. Returns None if nothing matched under RLS (→ 404)."""
    return await conn.fetchrow(
        f"""
        UPDATE subscriptions
        SET status = 'cancelled', cancellation_date = $2, updated_at = now()
        WHERE id = $1
        RETURNING {_COLUMNS}
        """,
        sub_id,
        cancellation_date,
    )
