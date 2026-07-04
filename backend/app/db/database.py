import asyncpg

from app.config import settings


async def ping_database() -> bool:
    """Open a short-lived connection and confirm the database responds.

    Minimal on purpose: the next task grows this into a shared asyncpg
    pool with a per-request RLS transaction wrapper. Readiness only needs
    to know the database is reachable, not hold a connection open.
    """
    conn = await asyncpg.connect(dsn=settings.database_url, timeout=5)
    try:
        await conn.fetchval("SELECT 1")
        return True
    finally:
        await conn.close()
