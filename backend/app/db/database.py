from app.db.pool import get_pool


async def ping_database() -> bool:
    """Confirm the database responds, using the shared pool."""
    pool = get_pool()
    async with pool.acquire() as conn:
        await conn.fetchval("SELECT 1")
    return True
