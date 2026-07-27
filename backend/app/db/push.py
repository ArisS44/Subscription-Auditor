import asyncpg

# Data access for push_subscriptions. Every function runs on an RLS-scoped
# connection (app.db.rls.rls_connection): this surface is entirely user-initiated,
# so row visibility is scoped to the caller by Postgres, never widened to the
# service role. Parameterized queries only. The keys are stored but never selected
# back to the client — only the columns a user needs to manage their devices are
# returned by the read path.
_RESPONSE_COLUMNS = "id, endpoint, user_agent, created_at"

# Hard cap on rows returned by the read path. A user has a handful of devices, but
# nothing in the schema *bounds* that — each distinct browser profile is another
# row — so the query is capped rather than left open-ended, satisfying the
# bounded-work-per-request rule. Well above any realistic device count, so it is a
# resource guard rather than pagination the client has to page through.
_MAX_DEVICES_RETURNED = 100


async def upsert_subscription(
    conn: asyncpg.Connection,
    *,
    user_id: str,
    endpoint: str,
    p256dh_key: str,
    auth_key: str,
    user_agent: str | None,
) -> asyncpg.Record:
    """Insert a device registration, or update its keys/label if this
    (user_id, endpoint) already exists. Re-subscribing the same device therefore
    refreshes rotated keys in place rather than creating a duplicate row — the
    UNIQUE(user_id, endpoint) constraint from the schema is what makes this an
    upsert. `user_id` comes from the JWT `sub` claim, and the RLS INSERT WITH CHECK
    policy independently verifies it equals auth.uid()."""
    return await conn.fetchrow(
        f"""
        INSERT INTO push_subscriptions (user_id, endpoint, p256dh_key, auth_key, user_agent)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (user_id, endpoint)
        DO UPDATE SET
            p256dh_key = EXCLUDED.p256dh_key,
            auth_key = EXCLUDED.auth_key,
            user_agent = EXCLUDED.user_agent
        RETURNING {_RESPONSE_COLUMNS}
        """,
        user_id,
        endpoint,
        p256dh_key,
        auth_key,
        user_agent,
    )


async def list_subscriptions(conn: asyncpg.Connection) -> list[asyncpg.Record]:
    """All of the caller's device registrations, keys included — the delivery
    fan-out needs p256dh/auth to encrypt. Row visibility is scoped by RLS on the
    connection; this adds no WHERE clause of its own."""
    return await conn.fetch(
        "SELECT id, endpoint, p256dh_key, auth_key FROM push_subscriptions "
        "ORDER BY created_at ASC"
    )


async def list_subscriptions_for_response(conn: asyncpg.Connection) -> list[asyncpg.Record]:
    """The caller's registrations without the encryption keys, for returning to
    the client that manages them. `p256dh_key`/`auth_key` are not in
    `_RESPONSE_COLUMNS`, so they cannot reach this result set at all — the read
    path never selects them. A secondary `id` sort makes the order deterministic
    when two devices share a `created_at`."""
    return await conn.fetch(
        f"SELECT {_RESPONSE_COLUMNS} FROM push_subscriptions "
        "ORDER BY created_at ASC, id ASC LIMIT $1",
        _MAX_DEVICES_RETURNED,
    )


async def delete_by_endpoint(conn: asyncpg.Connection, endpoint: str) -> asyncpg.Record | None:
    """Unsubscribe one device by its endpoint. RETURNING distinguishes a real
    delete (row returned) from nothing matched under RLS (None). RLS scopes the
    match to the caller's own rows, so one user cannot delete another's."""
    return await conn.fetchrow(
        "DELETE FROM push_subscriptions WHERE endpoint = $1 RETURNING id", endpoint
    )


async def delete_by_id(conn: asyncpg.Connection, subscription_id: object) -> asyncpg.Record | None:
    """Delete one registration by primary key — used to prune a subscription the
    push service reported as permanently gone. RLS scopes the match to the
    caller's rows."""
    return await conn.fetchrow(
        "DELETE FROM push_subscriptions WHERE id = $1 RETURNING id", subscription_id
    )
