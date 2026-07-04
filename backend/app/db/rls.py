import json
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import asyncpg

from app.db.pool import get_pool


@asynccontextmanager
async def rls_connection(claims: dict) -> AsyncIterator[asyncpg.Connection]:
    """Acquire a pooled connection scoped to the caller's identity via
    Postgres row-level security.

    `set_config(name, value, is_local=true)` is the parameterized
    equivalent of `SET LOCAL name = value` — it only takes effect inside
    an explicit transaction and is automatically reset when the
    transaction ends. That's the security boundary: without the
    transaction, `set_config(..., true)` silently no-ops and the query
    would run under the connection's default (superuser) privileges,
    bypassing RLS entirely. Because the setting is transaction-scoped, a
    pooled connection handed back after this request cannot leak the
    previous caller's claims to the next request that reuses it.

    `auth.uid()`, which every `profiles` RLS policy keys on, reads the
    `sub` claim out of `request.jwt.claims` — so `claims` must be the
    verified JWT payload, not a hand-built dict.
    """
    pool = get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute(
                "SELECT set_config('role', 'authenticated', true), "
                "set_config('request.jwt.claims', $1, true)",
                json.dumps(claims),
            )
            yield conn
